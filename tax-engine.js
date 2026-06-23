(function (root, factory) {
    const stateModules = typeof module === 'object' && module.exports
        ? require('./state-modules.js')
        : root.StateModules;
    const engine = factory(stateModules);

    if (typeof module === 'object' && module.exports) {
        module.exports = engine;
    }

    root.TaxEngine = engine;
}(typeof globalThis !== 'undefined' ? globalThis : this, function (stateModules) {
    'use strict';

    if (!stateModules || typeof stateModules.calculateStateModule !== 'function') {
        throw new Error('State module framework must load before the tax engine.');
    }

    const { calculateStateModule, STATE_MODULE_METADATA } = stateModules;

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
    const SELF_EMPLOYMENT_2026 = {
        netEarningsFactor: 0.9235,
        filingThreshold: 400,
        socialSecurityRate: 0.124,
        medicareRate: 0.029,
        socialSecurityWageBase: 184500,
        additionalMedicareRate: 0.009,
        additionalMedicareThreshold: { Single: 200000, MFJ: 250000, HOH: 200000 }
    };
    const QBI_2026 = {
        threshold: { Single: 201750, MFJ: 403500, HOH: 201750 },
        minimumQbi: 1000,
        minimumDeduction: 400,
        rate: 0.20
    };
    const IRMAA_2026 = {
        premiumYear: 2026,
        futurePlanningTaxYear: 2026,
        futurePremiumYear: 2028,
        brackets: {
            Single: [
                { max: 109000, partB: 0, partD: 0 },
                { max: 137000, partB: 81.20, partD: 14.50 },
                { max: 171000, partB: 202.90, partD: 37.50 },
                { max: 205000, partB: 324.60, partD: 60.40 },
                { max: 499999.99, partB: 446.30, partD: 83.30 },
                { max: Infinity, partB: 487.00, partD: 91.00 }
            ],
            MFJ: [
                { max: 218000, partB: 0, partD: 0 },
                { max: 274000, partB: 81.20, partD: 14.50 },
                { max: 342000, partB: 202.90, partD: 37.50 },
                { max: 410000, partB: 324.60, partD: 60.40 },
                { max: 749999.99, partB: 446.30, partD: 83.30 },
                { max: Infinity, partB: 487.00, partD: 91.00 }
            ]
        }
    };
    const SCHEDULE_C_EXPENSE_KEYS = [
        'labor', 'vehicleTravel', 'officeSoftware', 'rentUtilities',
        'insuranceProfessional', 'depreciationSection179', 'other'
    ];

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

    function normalizeOwnerInput(ownerValues = {}) {
        return {
            socialSecurityWages: Math.max(0, Number(ownerValues.socialSecurityWages) || 0),
            medicareWages: Math.max(0, Number(ownerValues.medicareWages) || 0),
            healthInsurance: Math.max(0, Number(ownerValues.healthInsurance) || 0),
            retirementPlan: Math.max(0, Number(ownerValues.retirementPlan) || 0)
        };
    }

    function normalizeBusiness(rawBusiness, index, isMFJ) {
        const amount = (key) => Math.max(0, Number(rawBusiness[key]) || 0);
        const owner = rawBusiness.owner === 'spouse' ? 'spouse' : 'taxpayer';
        const expenses = SCHEDULE_C_EXPENSE_KEYS.reduce((result, key) => {
            result[key] = Math.max(0, Number(rawBusiness.expenses && rawBusiness.expenses[key]) || 0);
            return result;
        }, {});
        const totalExpenses = rawBusiness.expenseMode === 'grouped'
            ? SCHEDULE_C_EXPENSE_KEYS.reduce((sum, key) => sum + expenses[key], 0)
            : amount('totalExpenses');
        const validForReturn = owner !== 'spouse' || isMFJ;
        const netProfit = amount('grossReceipts') - amount('returnsAllowances') - amount('costOfGoodsSold') +
            amount('otherIncome') - totalExpenses;
        const qbiEligibility = ['eligible', 'notEligible', 'unsure'].includes(rawBusiness.qbiEligibility)
            ? rawBusiness.qbiEligibility
            : 'eligible';
        const isSstb = rawBusiness.isSstb === true || rawBusiness.isSstb === 'yes'
            ? 'yes'
            : rawBusiness.isSstb === 'unsure' ? 'unsure' : 'no';
        const qualifiedTipsIncluded = Math.min(amount('qualifiedTipsIncluded'), amount('grossReceipts'));
        const eligibleBusinessTips = validForReturn && isSstb === 'no'
            ? Math.min(qualifiedTipsIncluded, Math.max(0, netProfit))
            : 0;

        return {
            id: rawBusiness.id || `business-${index + 1}`,
            name: String(rawBusiness.name || `Business ${index + 1}`),
            owner,
            validForReturn,
            grossReceipts: amount('grossReceipts'),
            returnsAllowances: amount('returnsAllowances'),
            costOfGoodsSold: amount('costOfGoodsSold'),
            otherIncome: amount('otherIncome'),
            expenseMode: rawBusiness.expenseMode === 'grouped' ? 'grouped' : 'total',
            totalExpenses,
            expenses,
            qualifiedTipsIncluded,
            eligibleBusinessTips,
            qbiEligibility,
            isSstb,
            netProfit
        };
    }

    function calculateScheduleCModule(rawValues, filingStatus) {
        const isMFJ = filingStatus === 'MFJ';
        const businesses = Array.isArray(rawValues.scheduleCBusinesses)
            ? rawValues.scheduleCBusinesses.map((business, index) => normalizeBusiness(business, index, isMFJ))
            : [];
        const rawOwners = rawValues.selfEmploymentOwners || {};
        const ownerInputs = {
            taxpayer: normalizeOwnerInput(rawOwners.taxpayer),
            spouse: normalizeOwnerInput(rawOwners.spouse)
        };
        const ownerResults = {};

        for (const owner of ['taxpayer', 'spouse']) {
            const ownerBusinesses = businesses.filter(business => business.validForReturn && business.owner === owner);
            const netProfit = ownerBusinesses.reduce((sum, business) => sum + business.netProfit, 0);
            const rawNetEarnings = Math.max(0, netProfit * SELF_EMPLOYMENT_2026.netEarningsFactor);
            const netEarnings = rawNetEarnings >= SELF_EMPLOYMENT_2026.filingThreshold ? rawNetEarnings : 0;
            const remainingSocialSecurityBase = Math.max(
                0,
                SELF_EMPLOYMENT_2026.socialSecurityWageBase - ownerInputs[owner].socialSecurityWages
            );
            const socialSecurityTax = Math.min(netEarnings, remainingSocialSecurityBase) * SELF_EMPLOYMENT_2026.socialSecurityRate;
            const medicareTax = netEarnings * SELF_EMPLOYMENT_2026.medicareRate;
            const regularSelfEmploymentTax = socialSecurityTax + medicareTax;
            const deductibleHalfSelfEmploymentTax = regularSelfEmploymentTax * 0.5;
            const eligibleQbiBeforeAdjustments = ownerBusinesses
                .filter(business => business.qbiEligibility === 'eligible')
                .reduce((sum, business) => sum + business.netProfit, 0);
            const qbiAdjustments = eligibleQbiBeforeAdjustments !== 0
                ? deductibleHalfSelfEmploymentTax + ownerInputs[owner].healthInsurance + ownerInputs[owner].retirementPlan
                : 0;

            ownerResults[owner] = {
                ...ownerInputs[owner],
                netProfit,
                rawNetEarnings,
                netEarnings,
                remainingSocialSecurityBase,
                socialSecurityTax,
                medicareTax,
                regularSelfEmploymentTax,
                deductibleHalfSelfEmploymentTax,
                eligibleQbiBeforeAdjustments,
                adjustedQbi: eligibleQbiBeforeAdjustments - qbiAdjustments
            };
        }

        const totalMedicareWages = ownerInputs.taxpayer.medicareWages + (isMFJ ? ownerInputs.spouse.medicareWages : 0);
        const totalNetEarnings = ownerResults.taxpayer.netEarnings + (isMFJ ? ownerResults.spouse.netEarnings : 0);
        const additionalMedicareThreshold = SELF_EMPLOYMENT_2026.additionalMedicareThreshold[filingStatus];
        const additionalMedicareTax = Math.max(
            0,
            totalMedicareWages + totalNetEarnings - additionalMedicareThreshold
        ) * SELF_EMPLOYMENT_2026.additionalMedicareRate;
        const priorYearQbiLossCarryforward = Math.max(0, Number(rawValues.priorYearQbiLossCarryforward) || 0);
        const adjustedQbi = ownerResults.taxpayer.adjustedQbi +
            (isMFJ ? ownerResults.spouse.adjustedQbi : 0) - priorYearQbiLossCarryforward;
        const validBusinesses = businesses.filter(business => business.validForReturn);
        const invalidSpouseBusinesses = businesses.filter(business => !business.validForReturn);

        return {
            businesses,
            owners: ownerResults,
            invalidSpouseBusinesses,
            hasBusinesses: businesses.length > 0,
            totalGrossReceipts: validBusinesses.reduce((sum, business) => sum + business.grossReceipts, 0),
            totalExpenses: validBusinesses.reduce((sum, business) => sum + business.totalExpenses + business.costOfGoodsSold, 0),
            totalNetProfit: validBusinesses.reduce((sum, business) => sum + business.netProfit, 0),
            eligibleBusinessTips: validBusinesses.reduce((sum, business) => sum + business.eligibleBusinessTips, 0),
            totalNetEarnings,
            regularSelfEmploymentTax: ownerResults.taxpayer.regularSelfEmploymentTax +
                (isMFJ ? ownerResults.spouse.regularSelfEmploymentTax : 0),
            deductibleHalfSelfEmploymentTax: ownerResults.taxpayer.deductibleHalfSelfEmploymentTax +
                (isMFJ ? ownerResults.spouse.deductibleHalfSelfEmploymentTax : 0),
            ownerHealthInsurance: ownerInputs.taxpayer.healthInsurance + (isMFJ ? ownerInputs.spouse.healthInsurance : 0),
            ownerRetirementPlan: ownerInputs.taxpayer.retirementPlan + (isMFJ ? ownerInputs.spouse.retirementPlan : 0),
            additionalMedicareTax,
            adjustedQbi,
            priorYearQbiLossCarryforward,
            qbiUncertainBusinesses: validBusinesses.filter(business => business.qbiEligibility === 'unsure'),
            ineligibleTipBusinesses: validBusinesses.filter(business =>
                business.qualifiedTipsIncluded > 0 && business.eligibleBusinessTips === 0
            )
        };
    }

    function getIrmaaFilingStatus(filingStatus) {
        return filingStatus === 'MFJ' ? 'MFJ' : 'Single';
    }

    function getIrmaaTier(magi, filingStatus) {
        const status = getIrmaaFilingStatus(filingStatus);
        const brackets = IRMAA_2026.brackets[status];
        const tierIndex = brackets.findIndex(bracket => magi <= bracket.max);
        const bracketIndex = tierIndex >= 0 ? tierIndex : brackets.length - 1;
        const bracket = brackets[bracketIndex];
        const nextThreshold = Number.isFinite(bracket.max) ? bracket.max : null;
        const monthlyAdjustmentPerPerson = bracket.partB + bracket.partD;

        return {
            filingStatus: status,
            magi,
            tierIndex: bracketIndex,
            tierLabel: bracketIndex === 0 ? 'No IRMAA' : `IRMAA tier ${bracketIndex}`,
            partBMonthlyAdjustment: bracket.partB,
            partDMonthlyAdjustment: bracket.partD,
            monthlyAdjustmentPerPerson,
            annualAdjustmentPerPerson: monthlyAdjustmentPerPerson * 12,
            nextThreshold,
            roomToNextTier: nextThreshold == null ? null : Math.max(0, nextThreshold - magi)
        };
    }

    function calculateIrmaaModule(rawValues, filingStatus, projectedAgi, medicareEnrollees) {
        const n = (key) => Number(rawValues[key]) || 0;
        const projectedTaxExemptInterest = Math.max(0, n('irmaaProjectedTaxExemptInterest'));
        const projectedMagi = Math.max(0, projectedAgi + projectedTaxExemptInterest);
        const projectedTier = getIrmaaTier(projectedMagi, filingStatus);

        return {
            premiumYear: IRMAA_2026.premiumYear,
            futurePlanningTaxYear: IRMAA_2026.futurePlanningTaxYear,
            futurePremiumYear: IRMAA_2026.futurePremiumYear,
            medicareEnrollees,
            filingStatus: projectedTier.filingStatus,
            projected: {
                hasInput: true,
                agi: projectedAgi,
                taxExemptInterest: projectedTaxExemptInterest,
                householdAnnualAdjustment: projectedTier.annualAdjustmentPerPerson * medicareEnrollees,
                ...projectedTier
            }
        };
    }

    function calculateTaxLiability(rawValues) {
        const values = { ...rawValues };
        const filingStatus = TAX_BRACKETS_2026[values.filingStatus] ? values.filingStatus : 'Single';
        const isMFJ = filingStatus === 'MFJ';
        const n = (key) => Number(values[key]) || 0;
        const checked = (key) => Boolean(values[key]);

        const scheduleC = calculateScheduleCModule(values, filingStatus);
        const employeeQualifiedTips = values.employeeQualifiedTips == null ? n('tips') : n('employeeQualifiedTips');
        const taxableIraRegular = Math.max(0, n('iraRegular') - n('iraQCD'));
        const totalTaxableIRA = taxableIraRegular + n('iraRothConv');
        const ordinaryDivs = Math.max(0, n('totalDividends') - n('qualifiedDivs'));
        const grossNonSS = n('wages') + employeeQualifiedTips + n('overtime') + n('interest') + n('totalDividends') +
            n('ltcg') + n('stcg') + totalTaxableIRA + n('pensions') + scheduleC.totalNetProfit;
        const aboveLineAdjustments = n('iraContrib') + n('hsaContrib') +
            scheduleC.deductibleHalfSelfEmploymentTax + scheduleC.ownerHealthInsurance + scheduleC.ownerRetirementPlan;
        const provisionalIncome = grossNonSS - aboveLineAdjustments + (n('socialSecurity') * 0.5);

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
        const finalAGI = Math.max(0, preliminaryAGI - aboveLineAdjustments);

        // Schedule 1-A deductions reduce taxable income, not adjusted gross income.
        const tipsConfig = SCHEDULE_1A_LIMITS.tips;
        const tipsThreshold = isMFJ ? tipsConfig.thresholdMFJ : tipsConfig.thresholdSingle;
        const qualifiedTips = Math.min(employeeQualifiedTips + scheduleC.eligibleBusinessTips, tipsConfig.limit);
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
        const irmaa = calculateIrmaaModule(values, filingStatus, finalAGI, ageCount);

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
        const preferentialIncome = n('qualifiedDivs') + n('ltcg');
        const preQbiTaxableIncome = Math.max(0, finalAGI - finalDeduction - additionalDeductions);
        const qbiTaxableIncomeLimit = QBI_2026.rate * Math.max(0, preQbiTaxableIncome - preferentialIncome);
        let simpleQbiDeduction = QBI_2026.rate * Math.max(0, scheduleC.adjustedQbi);
        if (scheduleC.adjustedQbi >= QBI_2026.minimumQbi) {
            simpleQbiDeduction = Math.max(simpleQbiDeduction, QBI_2026.minimumDeduction);
        }
        const potentialQbiDeduction = Math.min(simpleQbiDeduction, qbiTaxableIncomeLimit);
        const qbiReviewRequired = potentialQbiDeduction > 0 && preQbiTaxableIncome > QBI_2026.threshold[filingStatus];
        const qbiDeduction = qbiReviewRequired ? 0 : potentialQbiDeduction;
        const taxableIncome = Math.max(0, preQbiTaxableIncome - qbiDeduction);

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
        let incomeTaxEstimate = Math.max(0, taxBeforeCredits - totalCredits);

        const netInvestmentIncome = n('interest') + n('totalDividends') + n('ltcg') + n('stcg');
        const magiExcess = Math.max(0, finalAGI - NIIT_THRESHOLDS[filingStatus]);
        const niit = magiExcess > 0 ? Math.min(netInvestmentIncome, magiExcess) * 0.038 : 0;
        incomeTaxEstimate += niit;

        const totalFederalTax = incomeTaxEstimate + scheduleC.regularSelfEmploymentTax + scheduleC.additionalMedicareTax;
        const totalTax = totalFederalTax;

        const totalRealIncome = grossNonSS + n('socialSecurity');
        const incomeTaxEffectiveRate = totalRealIncome > 0 ? incomeTaxEstimate / totalRealIncome : 0;
        const realEffectiveRate = totalRealIncome > 0 ? totalFederalTax / totalRealIncome : 0;

        const stateResult = calculateStateModule(values.stateModule, {
            values,
            filingStatus,
            isMFJ,
            ageCount,
            blindCount,
            taxableSS,
            federalAGI: finalAGI,
            federalTaxableIncome: taxableIncome,
            federalStandardDeduction: STANDARD_DEDUCTION_2026[filingStatus],
            usedStandard,
            scheduleC,
            deductibleTips,
            deductibleOT,
            seniorBonus
        });

        // Preserve the original result fields while the interface migrates to the shared state contract.
        const azTax = stateResult.code === 'AZ' ? stateResult.tax : 0;
        const azTaxable = stateResult.code === 'AZ' ? stateResult.taxableIncome : 0;
        const azDedDisplay = stateResult.code === 'AZ' ? stateResult.deduction : 0;
        const azCreditsDisplay = stateResult.code === 'AZ' ? stateResult.credits : 0;
        const govtPenExclusion = stateResult.details.govtPensionExclusion || 0;
        const ded529 = stateResult.details.deduction529 || 0;
        const dedLtcg = stateResult.details.ltcgSubtraction || 0;
        const azQualifiedTipsSubtraction = stateResult.details.qualifiedTipsSubtraction || 0;
        const azQualifiedOvertimeSubtraction = stateResult.details.qualifiedOvertimeSubtraction || 0;
        const azSeniorSubtraction = stateResult.details.seniorSubtraction || 0;
        const az530ASubtraction = stateResult.details.distribution530ASubtraction || 0;
        const azDependentCareSubtraction = stateResult.details.dependentCareSubtraction || 0;
        const azProductionPropertyAddback = stateResult.details.qualifiedProductionPropertyAddback || 0;
        const caTax = stateResult.code === 'CA' ? stateResult.tax : 0;
        const caTaxable = stateResult.code === 'CA' ? stateResult.taxableIncome : 0;
        const caDedDisplay = stateResult.code === 'CA' ? stateResult.deduction : 0;
        const caCreditsDisplay = stateResult.code === 'CA' ? stateResult.credits : 0;
        const caAddBacks = stateResult.code === 'CA' ? stateResult.additions : 0;
        const caSubtractions = stateResult.code === 'CA' ? stateResult.subtractions : 0;
        const caBaseTax = stateResult.details.baseTax || 0;
        const caMentalHealthTax = stateResult.details.mentalHealthTax || 0;
        const caAgi = stateResult.code === 'CA' ? stateResult.adjustedGrossIncome : 0;

        return {
            totalTax,
            totalFederalTax,
            incomeTaxEstimate,
            regularSelfEmploymentTax: scheduleC.regularSelfEmploymentTax,
            additionalMedicareTax: scheduleC.additionalMedicareTax,
            ordinaryTax: ordinaryResult.tax,
            ltcgTax,
            niit,
            totalCredits,
            realEffectiveRate,
            incomeTaxEffectiveRate,
            totalRealIncome,
            taxableSS,
            preliminaryAGI,
            finalAGI,
            aboveLineAdjustments,
            usedStandard,
            finalDeduction,
            additionalDeductions,
            preQbiTaxableIncome,
            qbiDeduction,
            potentialQbiDeduction,
            qbiReviewRequired,
            qbiThreshold: QBI_2026.threshold[filingStatus],
            adjustedQbi: scheduleC.adjustedQbi,
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
            irmaa,
            scheduleC,
            stateResult,
            azTax,
            azTaxable,
            azDedDisplay,
            azCreditsDisplay,
            govtPenExclusion,
            ded529,
            dedLtcg,
            azQualifiedTipsSubtraction,
            azQualifiedOvertimeSubtraction,
            azSeniorSubtraction,
            az530ASubtraction,
            azDependentCareSubtraction,
            azProductionPropertyAddback,
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
        return result.stateResult && result.stateResult.code === stateModule
            ? result.stateResult.tax
            : 0;
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
            taxableIncomeDelta: proposed.taxableIncome - baseline.taxableIncome,
            qbiReviewRequired: baseline.qbiReviewRequired || proposed.qbiReviewRequired
        };
    }

    function findMaximumAdditional(calculateAdditional, isWithinTarget, maxAdditional) {
        if (!isWithinTarget(calculateAdditional(0)) || maxAdditional <= 0) {
            return { room: 0, cappedBySearch: false };
        }

        let low = 0;
        let high = maxAdditional;
        while (low < high) {
            const midpoint = Math.ceil((low + high) / 2);
            if (isWithinTarget(calculateAdditional(midpoint))) {
                low = midpoint;
            } else {
                high = midpoint - 1;
            }
        }

        return {
            room: low,
            cappedBySearch: low === maxAdditional && isWithinTarget(calculateAdditional(maxAdditional))
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

        const search = findMaximumAdditional(
            calculateAdditional,
            result => !result.qbiReviewRequired && result.currentBracket.rate <= targetRate,
            maxAdditional
        );
        const { room, cappedBySearch } = search;
        const boundaryResult = calculateAdditional(Math.min(maxAdditional, room + 1));
        const qbiReviewRequired = baseResult.qbiReviewRequired || boundaryResult.qbiReviewRequired;

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
            qbiReviewRequired,
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

    function analyzeCapitalGainHarvesting(rawValues, options = {}) {
        const values = { ...rawValues };
        const baseLongTermGain = Number(values.ltcg) || 0;
        const baseResult = calculateTaxLiability(values);
        const filingStatus = LTCG_BRACKETS_2026[values.filingStatus] ? values.filingStatus : 'Single';
        const requestedRate = Number(options.targetRate);
        const targetRate = requestedRate === 0 ? 0 : 0.15;
        const targetThreshold = targetRate === 0
            ? LTCG_BRACKETS_2026[filingStatus].zero
            : LTCG_BRACKETS_2026[filingStatus].fifteen;
        const maxAdditional = Math.max(0, Math.floor(Number(options.maxAdditional) || 1000000));
        const probeAmount = Math.max(1, Math.floor(Number(options.probeAmount) || 1000));

        const calculateAdditional = (additionalGain) => calculateTaxLiability({
            ...values,
            ltcg: baseLongTermGain + additionalGain
        });
        const search = findMaximumAdditional(
            calculateAdditional,
            result => !result.qbiReviewRequired && result.taxableIncome <= targetThreshold,
            maxAdditional
        );
        const { room, cappedBySearch } = search;
        const boundaryResult = calculateAdditional(Math.min(maxAdditional, room + 1));
        const qbiReviewRequired = baseResult.qbiReviewRequired || boundaryResult.qbiReviewRequired;
        const targetResult = calculateAdditional(room);
        const nextResult = calculateAdditional(probeAmount);

        const baseStateTax = getStateTax(baseResult, values.stateModule);
        const targetStateTax = getStateTax(targetResult, values.stateModule);
        const nextStateTax = getStateTax(nextResult, values.stateModule);
        const directLtcgTaxCost = targetResult.ltcgTax - baseResult.ltcgTax;
        const federalTaxCost = targetResult.totalTax - baseResult.totalTax;
        const federalInteractionCost = federalTaxCost - directLtcgTaxCost;
        const stateTaxCost = targetStateTax - baseStateTax;
        const combinedTaxCost = federalTaxCost + stateTaxCost;
        const taxableSSIncrease = targetResult.taxableSS - baseResult.taxableSS;
        const nextDirectLtcgTax = nextResult.ltcgTax - baseResult.ltcgTax;
        const nextFederalTax = nextResult.totalTax - baseResult.totalTax;
        const nextStateTaxCost = nextStateTax - baseStateTax;

        return {
            targetRate,
            targetThreshold,
            room,
            cappedBySearch,
            qbiReviewRequired,
            baseResult,
            targetResult,
            directLtcgTaxCost,
            federalInteractionCost,
            federalTaxCost,
            stateTaxCost,
            combinedTaxCost,
            taxableSSIncrease,
            ordinaryTaxCost: targetResult.ordinaryTax - baseResult.ordinaryTax,
            niitCost: targetResult.niit - baseResult.niit,
            creditChange: targetResult.totalCredits - baseResult.totalCredits,
            blendedFederalRate: room > 0 ? federalTaxCost / room : 0,
            blendedCombinedRate: room > 0 ? combinedTaxCost / room : 0,
            probeAmount,
            nextDirectLtcgTax,
            nextFederalTax,
            nextStateTax: nextStateTaxCost,
            nextCombinedTax: nextFederalTax + nextStateTaxCost,
            nextDirectLtcgRate: nextDirectLtcgTax / probeAmount,
            nextFederalRate: nextFederalTax / probeAmount,
            nextCombinedRate: (nextFederalTax + nextStateTaxCost) / probeAmount
        };
    }

    return {
        TAX_BRACKETS_2026,
        CTC_AMOUNT_2026,
        ODC_AMOUNT_2026,
        CTC_THRESHOLD,
        SALT_2026,
        SELF_EMPLOYMENT_2026,
        QBI_2026,
        IRMAA_2026,
        STATE_MODULE_METADATA,
        getSaltCap,
        calculateScheduleCModule,
        calculateTaxLiability,
        compareScenarios,
        analyzeRothConversion,
        analyzeCapitalGainHarvesting
    };
}));
