(function (root, factory) {
    const engine = factory();

    if (typeof module === 'object' && module.exports) {
        module.exports = engine;
    }

    root.TaxEngine = engine;
}(typeof globalThis !== 'undefined' ? globalThis : this, function () {
    'use strict';

    const TAX_BRACKETS_2026 = {
        Single: [
            { max: 12400, rate: 0.10 }, { max: 50400, rate: 0.12 }, { max: 105700, rate: 0.22 },
            { max: 201775, rate: 0.24 }, { max: 256225, rate: 0.32 }, { max: 640600, rate: 0.35 }, { max: Infinity, rate: 0.37 }
        ],
        MFJ: [
            { max: 24800, rate: 0.10 }, { max: 100800, rate: 0.12 }, { max: 211400, rate: 0.22 },
            { max: 403550, rate: 0.24 }, { max: 512450, rate: 0.32 }, { max: 768700, rate: 0.35 }, { max: Infinity, rate: 0.37 }
        ],
        HOH: [
            { max: 17700, rate: 0.10 }, { max: 67450, rate: 0.12 }, { max: 105700, rate: 0.22 },
            { max: 201750, rate: 0.24 }, { max: 256200, rate: 0.32 }, { max: 640600, rate: 0.35 }, { max: Infinity, rate: 0.37 }
        ]
    };

    const LTCG_BRACKETS_2026 = {
        Single: { zero: 49450, fifteen: 545500 },
        MFJ: { zero: 98900, fifteen: 613700 },
        HOH: { zero: 66200, fifteen: 579600 }
    };

    const STANDARD_DEDUCTION_2026 = { Single: 16100, MFJ: 32200, HOH: 24150 };
    const AGE_BLIND_ADDITION_2026 = { Single: 2050, MFJ: 1650, HOH: 2050 };
    const SENIOR_DEDUCTION = {
        Single: { threshold: 75000, rate: 0.06 },
        MFJ: { threshold: 150000, rate: 0.06 }
    };
    const SCHEDULE_1A_LIMITS = {
        tips: { limit: 25000, thresholdSingle: 150000, thresholdMFJ: 300000, rate: 0.10 },
        overtime: { limitSingle: 12500, limitMFJ: 25000, thresholdSingle: 150000, thresholdMFJ: 300000, rate: 0.10 },
        auto: { limit: 10000, thresholdSingle: 100000, thresholdMFJ: 200000, rate: 0.20 }
    };
    const SALT_2026 = { maximum: 40400, phaseDownThreshold: 505000, phaseDownRate: 0.30, floor: 10000 };
    const CTC_AMOUNT_2026 = 2200;
    const ODC_AMOUNT_2026 = 500;
    const CTC_THRESHOLD = { Single: 200000, MFJ: 400000, HOH: 200000 };
    const NIIT_THRESHOLDS = { Single: 200000, MFJ: 250000, HOH: 200000 };

    // California amounts remain planning estimates until the state publishes final 2026 figures.
    const CA_BRACKETS_2026 = {
        Single: [
            { max: 11356, rate: 0.01 }, { max: 26921, rate: 0.02 }, { max: 42488, rate: 0.04 },
            { max: 58981, rate: 0.06 }, { max: 74542, rate: 0.08 }, { max: 379845, rate: 0.093 },
            { max: 455809, rate: 0.103 }, { max: 759683, rate: 0.113 }, { max: Infinity, rate: 0.123 }
        ],
        MFJ: [
            { max: 22712, rate: 0.01 }, { max: 53841, rate: 0.02 }, { max: 84977, rate: 0.04 },
            { max: 117961, rate: 0.06 }, { max: 149084, rate: 0.08 }, { max: 759689, rate: 0.093 },
            { max: 911619, rate: 0.103 }, { max: 1519366, rate: 0.113 }, { max: Infinity, rate: 0.123 }
        ],
        HOH: [
            { max: 22727, rate: 0.01 }, { max: 53843, rate: 0.02 }, { max: 69409, rate: 0.04 },
            { max: 85900, rate: 0.06 }, { max: 101465, rate: 0.08 }, { max: 517838, rate: 0.093 },
            { max: 621407, rate: 0.103 }, { max: 1035677, rate: 0.113 }, { max: Infinity, rate: 0.123 }
        ]
    };
    const CA_STANDARD_DEDUCTION = { Single: 5678, MFJ: 11356, HOH: 11356 };
    const CA_EXEMPTION_CREDITS = { Personal: 155, Dependent: 486, Senior: 155 };

    function getSaltCap(magi) {
        const excessMagi = Math.max(0, magi - SALT_2026.phaseDownThreshold);
        return Math.max(SALT_2026.floor, SALT_2026.maximum - (excessMagi * SALT_2026.phaseDownRate));
    }

    function calculateProgressiveTax(income, brackets) {
        let tax = 0;
        let previousMax = 0;
        let currentBracket = brackets[0];

        for (const bracket of brackets) {
            if (income > previousMax) {
                const taxableInBracket = Math.min(income, bracket.max) - previousMax;
                tax += taxableInBracket * bracket.rate;
                currentBracket = bracket;
                previousMax = bracket.max;
            }
        }

        return { tax, currentBracket };
    }

    function calculateTaxLiability(rawValues) {
        const values = { ...rawValues };
        const filingStatus = TAX_BRACKETS_2026[values.filingStatus] ? values.filingStatus : 'Single';
        const isMFJ = filingStatus === 'MFJ';
        const n = (key) => Number(values[key]) || 0;
        const checked = (key) => Boolean(values[key]);

        const taxableIraRegular = Math.max(0, n('iraRegular') - n('iraQCD'));
        const totalTaxableIRA = taxableIraRegular + n('iraRothConv');
        const ordinaryDivs = Math.max(0, n('totalDividends') - n('qualifiedDivs'));
        const grossNonSS = n('wages') + n('tips') + n('overtime') + n('interest') + n('totalDividends') +
            n('ltcg') + n('stcg') + totalTaxableIRA + n('pensions');
        const provisionalIncome = grossNonSS + (n('socialSecurity') * 0.5);

        const ssThreshold1 = isMFJ ? 32000 : 25000;
        const ssThreshold2 = isMFJ ? 44000 : 34000;
        let taxableSS = 0;
        if (provisionalIncome > ssThreshold2) {
            taxableSS = 0.85 * (provisionalIncome - ssThreshold2) + 0.5 * (ssThreshold2 - ssThreshold1);
        } else if (provisionalIncome > ssThreshold1) {
            taxableSS = 0.5 * (provisionalIncome - ssThreshold1);
        }
        taxableSS = Math.max(0, Math.min(taxableSS, 0.85 * n('socialSecurity')));

        const preliminaryAGI = grossNonSS + taxableSS;
        const aboveLineAdjustments = n('iraContrib') + n('hsaContrib');
        const finalAGI = Math.max(0, preliminaryAGI - aboveLineAdjustments);

        // Schedule 1-A deductions reduce taxable income, not adjusted gross income.
        const tipsConfig = SCHEDULE_1A_LIMITS.tips;
        const tipsThreshold = isMFJ ? tipsConfig.thresholdMFJ : tipsConfig.thresholdSingle;
        const qualifiedTips = Math.min(n('tips'), tipsConfig.limit);
        const deductibleTips = Math.max(0, qualifiedTips - (Math.max(0, finalAGI - tipsThreshold) * tipsConfig.rate));

        const overtimeConfig = SCHEDULE_1A_LIMITS.overtime;
        const overtimeLimit = isMFJ ? overtimeConfig.limitMFJ : overtimeConfig.limitSingle;
        const overtimeThreshold = isMFJ ? overtimeConfig.thresholdMFJ : overtimeConfig.thresholdSingle;
        const qualifiedOvertime = Math.min(n('overtime'), overtimeLimit);
        const deductibleOT = Math.max(0, qualifiedOvertime - (Math.max(0, finalAGI - overtimeThreshold) * overtimeConfig.rate));

        let deductibleAuto = 0;
        if (checked('isUSCar') && n('autoLoanInterest') > 0) {
            const autoConfig = SCHEDULE_1A_LIMITS.auto;
            const autoThreshold = isMFJ ? autoConfig.thresholdMFJ : autoConfig.thresholdSingle;
            const qualifiedAutoInterest = Math.min(n('autoLoanInterest'), autoConfig.limit);
            deductibleAuto = Math.max(0, qualifiedAutoInterest - (Math.max(0, finalAGI - autoThreshold) * autoConfig.rate));
        }

        let ageCount = 0;
        if (n('ageSelf') >= 65) ageCount++;
        if (isMFJ && n('ageSpouse') >= 65) ageCount++;

        let blindCount = 0;
        if (checked('blindSelf')) blindCount++;
        if (isMFJ && checked('blindSpouse')) blindCount++;

        const baseStandard = STANDARD_DEDUCTION_2026[filingStatus];
        const ageBlindAmount = (ageCount + blindCount) * AGE_BLIND_ADDITION_2026[isMFJ ? 'MFJ' : filingStatus];
        const totalStandard = baseStandard + ageBlindAmount;

        let seniorBonus = 0;
        let sbReductionAmount = 0;
        if (ageCount > 0) {
            const seniorConfig = isMFJ ? SENIOR_DEDUCTION.MFJ : SENIOR_DEDUCTION.Single;
            const baseSeniorDeduction = ageCount * 6000;
            sbReductionAmount = Math.min(
                baseSeniorDeduction,
                Math.max(0, finalAGI - seniorConfig.threshold) * seniorConfig.rate
            );
            seniorBonus = Math.max(0, baseSeniorDeduction - sbReductionAmount);
        }

        const saltCap = getSaltCap(finalAGI);
        const limitedSALT = Math.min(n('salt'), saltCap);
        const totalItemized = limitedSALT + n('mortgageInterest') + n('charity');
        const usedStandard = totalStandard >= totalItemized;
        const finalDeduction = usedStandard ? totalStandard : totalItemized;
        const additionalDeductions = deductibleTips + deductibleOT + deductibleAuto + seniorBonus;
        const taxableIncome = Math.max(0, finalAGI - finalDeduction - additionalDeductions);

        const preferentialIncome = n('qualifiedDivs') + n('ltcg');
        const ordinaryIncome = Math.max(0, taxableIncome - preferentialIncome);
        const ordinaryResult = calculateProgressiveTax(ordinaryIncome, TAX_BRACKETS_2026[filingStatus]);

        let ltcgTax = 0;
        const ltcgBrackets = LTCG_BRACKETS_2026[filingStatus];
        let currentStack = ordinaryIncome;
        let remainingLTCG = Math.max(0, taxableIncome - ordinaryIncome);

        const zeroSpace = Math.max(0, ltcgBrackets.zero - currentStack);
        const taxedAtZero = Math.min(remainingLTCG, zeroSpace);
        remainingLTCG -= taxedAtZero;
        currentStack += taxedAtZero;

        const fifteenSpace = Math.max(0, ltcgBrackets.fifteen - currentStack);
        const taxedAtFifteen = Math.min(remainingLTCG, fifteenSpace);
        ltcgTax += taxedAtFifteen * 0.15;
        remainingLTCG -= taxedAtFifteen;

        if (remainingLTCG > 0) {
            ltcgTax += remainingLTCG * 0.20;
        }

        const taxBeforeCredits = ordinaryResult.tax + ltcgTax;
        const rawCredits = (n('childDependents') * CTC_AMOUNT_2026) + (n('otherDependents') * ODC_AMOUNT_2026);
        const creditThreshold = CTC_THRESHOLD[filingStatus];
        const creditReduction = Math.ceil(Math.max(0, finalAGI - creditThreshold) / 1000) * 50;
        const totalCredits = Math.max(0, rawCredits - creditReduction);
        let totalTax = Math.max(0, taxBeforeCredits - totalCredits);

        const netInvestmentIncome = n('interest') + n('totalDividends') + n('ltcg') + n('stcg');
        const magiExcess = Math.max(0, finalAGI - NIIT_THRESHOLDS[filingStatus]);
        const niit = magiExcess > 0 ? Math.min(netInvestmentIncome, magiExcess) * 0.038 : 0;
        totalTax += niit;

        const totalRealIncome = grossNonSS + n('socialSecurity');
        const realEffectiveRate = totalRealIncome > 0 ? totalTax / totalRealIncome : 0;

        let azTax = 0;
        let azTaxable = 0;
        let azDedDisplay = 0;
        let azCreditsDisplay = 0;
        let govtPenExclusion = 0;
        let ded529 = 0;
        let dedLtcg = 0;
        let caTax = 0;
        let caTaxable = 0;
        let caDedDisplay = 0;
        let caCreditsDisplay = 0;
        let caAddBacks = 0;
        let caSubtractions = 0;
        let caBaseTax = 0;
        let caMentalHealthTax = 0;
        let caAgi = 0;

        if (values.stateModule === 'AZ') {
            let azIncome = finalAGI - taxableSS - n('usGovInterest') - n('milPension');
            const pensionCap = isMFJ ? 5000 : 2500;
            govtPenExclusion = Math.min(pensionCap, n('govtPension'));
            azIncome -= govtPenExclusion;

            ded529 = Math.min(n('az529'), isMFJ ? 4000 : 2000);
            azIncome -= ded529;
            dedLtcg = n('azLtcgPost2011') * 0.25;
            azIncome -= dedLtcg;

            const azStandard = STANDARD_DEDUCTION_2026[filingStatus] + (n('charity') * 0.34);
            const azItemized = n('mortgageInterest') + n('charity');
            azDedDisplay = Math.max(azStandard, azItemized);
            azTaxable = Math.max(0, azIncome - azDedDisplay);
            azTax = azTaxable * 0.025;

            let azDependentCredit = (n('childDependents') * 100) + (n('otherDependents') * 25);
            const azCreditLimit = isMFJ ? 400000 : 200000;
            if (finalAGI > azCreditLimit) {
                const reductionSteps = Math.ceil((finalAGI - azCreditLimit) / 1000);
                azDependentCredit *= Math.max(0, 1 - (reductionSteps * 0.05));
            }
            azCreditsDisplay = azDependentCredit;
            azTax = Math.max(0, azTax - azDependentCredit);
        } else if (values.stateModule === 'CA') {
            // California does not conform to the federal HSA deduction.
            caAddBacks = n('hsaContrib');
            caSubtractions = taxableSS + n('usGovInterest');
            caAgi = finalAGI + caAddBacks - caSubtractions;

            const caItemized = n('mortgageInterest') + n('charity');
            caDedDisplay = Math.max(CA_STANDARD_DEDUCTION[filingStatus], caItemized);
            caTaxable = Math.max(0, caAgi - caDedDisplay);
            caBaseTax = calculateProgressiveTax(caTaxable, CA_BRACKETS_2026[filingStatus]).tax;
            caMentalHealthTax = caTaxable > 1000000 ? (caTaxable - 1000000) * 0.01 : 0;

            let exemptionCredits = CA_EXEMPTION_CREDITS.Personal * (isMFJ ? 2 : 1);
            exemptionCredits += ageCount * CA_EXEMPTION_CREDITS.Senior;
            exemptionCredits += blindCount * CA_EXEMPTION_CREDITS.Senior;
            exemptionCredits += (n('childDependents') + n('otherDependents')) * CA_EXEMPTION_CREDITS.Dependent;
            caCreditsDisplay = exemptionCredits;
            caTax = Math.max(0, caBaseTax + caMentalHealthTax - exemptionCredits);
        }

        return {
            totalTax,
            ordinaryTax: ordinaryResult.tax,
            ltcgTax,
            niit,
            totalCredits,
            realEffectiveRate,
            totalRealIncome,
            taxableSS,
            preliminaryAGI,
            finalAGI,
            aboveLineAdjustments,
            usedStandard,
            finalDeduction,
            additionalDeductions,
            taxableIncome,
            deductibleTips,
            deductibleOT,
            deductibleAuto,
            totalStandard,
            totalItemized,
            saltCap,
            limitedSALT,
            baseStandard,
            ageBlindAmount,
            seniorBonus,
            sbReductionAmount,
            ordinaryDivs,
            taxableIraRegular,
            azTax,
            azTaxable,
            azDedDisplay,
            azCreditsDisplay,
            govtPenExclusion,
            ded529,
            dedLtcg,
            caTax,
            caTaxable,
            caDedDisplay,
            caCreditsDisplay,
            caAddBacks,
            caSubtractions,
            caBaseTax,
            caMentalHealthTax,
            caAgi,
            currentBracket: ordinaryResult.currentBracket,
            ordinaryIncome
        };
    }

    function getStateTax(result, stateModule) {
        if (stateModule === 'AZ') return result.azTax;
        if (stateModule === 'CA') return result.caTax;
        return 0;
    }

    function compareScenarios(baselineValues, proposedValues) {
        const baseline = calculateTaxLiability(baselineValues);
        const proposed = calculateTaxLiability(proposedValues);
        const baselineStateTax = getStateTax(baseline, baselineValues.stateModule);
        const proposedStateTax = getStateTax(proposed, proposedValues.stateModule);
        const baselineCombinedTax = baseline.totalTax + baselineStateTax;
        const proposedCombinedTax = proposed.totalTax + proposedStateTax;

        return {
            baseline,
            proposed,
            baselineStateTax,
            proposedStateTax,
            baselineCombinedTax,
            proposedCombinedTax,
            federalTaxDelta: proposed.totalTax - baseline.totalTax,
            stateTaxDelta: proposedStateTax - baselineStateTax,
            combinedTaxDelta: proposedCombinedTax - baselineCombinedTax,
            agiDelta: proposed.finalAGI - baseline.finalAGI,
            taxableIncomeDelta: proposed.taxableIncome - baseline.taxableIncome
        };
    }

    function analyzeRothConversion(rawValues, options = {}) {
        const values = { ...rawValues };
        const baseConversion = Number(values.iraRothConv) || 0;
        const baseResult = calculateTaxLiability(values);
        const requestedRate = options.targetRate === 'current' || options.targetRate == null
            ? baseResult.currentBracket.rate
            : Number(options.targetRate);
        const targetRate = Number.isFinite(requestedRate) ? requestedRate : baseResult.currentBracket.rate;
        const maxAdditional = Math.max(0, Math.floor(Number(options.maxAdditional) || 1000000));
        const probeAmount = Math.max(1, Math.floor(Number(options.probeAmount) || 1000));

        const calculateAdditional = (additionalConversion) => calculateTaxLiability({
            ...values,
            iraRothConv: baseConversion + additionalConversion
        });

        let room = 0;
        let cappedBySearch = false;
        if (baseResult.currentBracket.rate <= targetRate && maxAdditional > 0) {
            let low = 0;
            let high = maxAdditional;
            while (low < high) {
                const midpoint = Math.ceil((low + high) / 2);
                const midpointResult = calculateAdditional(midpoint);
                if (midpointResult.currentBracket.rate <= targetRate) {
                    low = midpoint;
                } else {
                    high = midpoint - 1;
                }
            }
            room = low;
            cappedBySearch = room === maxAdditional && calculateAdditional(maxAdditional).currentBracket.rate <= targetRate;
        }

        const targetResult = calculateAdditional(room);
        const nextResult = calculateAdditional(probeAmount);
        const baseStateTax = getStateTax(baseResult, values.stateModule);
        const targetStateTax = getStateTax(targetResult, values.stateModule);
        const nextScenarioStateTax = getStateTax(nextResult, values.stateModule);
        const federalTaxCost = targetResult.totalTax - baseResult.totalTax;
        const stateTaxCost = targetStateTax - baseStateTax;
        const combinedTaxCost = federalTaxCost + stateTaxCost;
        const nextFederalTax = nextResult.totalTax - baseResult.totalTax;
        const nextStateTax = nextScenarioStateTax - baseStateTax;

        return {
            targetRate,
            room,
            cappedBySearch,
            baseResult,
            targetResult,
            federalTaxCost,
            stateTaxCost,
            combinedTaxCost,
            blendedRate: room > 0 ? combinedTaxCost / room : 0,
            probeAmount,
            nextFederalTax,
            nextStateTax,
            nextCombinedTax: nextFederalTax + nextStateTax,
            nextFederalRate: nextFederalTax / probeAmount,
            nextCombinedRate: (nextFederalTax + nextStateTax) / probeAmount
        };
    }

    return {
        TAX_BRACKETS_2026,
        CTC_AMOUNT_2026,
        ODC_AMOUNT_2026,
        CTC_THRESHOLD,
        SALT_2026,
        getSaltCap,
        calculateTaxLiability,
        compareScenarios,
        analyzeRothConversion
    };
}));
