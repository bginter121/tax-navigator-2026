(function (root, factory) {
    const stateModules = factory();

    if (typeof module === 'object' && module.exports) {
        module.exports = stateModules;
    }

    root.StateModules = stateModules;
}(typeof globalThis !== 'undefined' ? globalThis : this, function () {
    'use strict';

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
    const CO_TAX_RATE_2026 = 0.044;
    const VA_BRACKETS = [
        { max: 3000, rate: 0.02 },
        { max: 5000, rate: 0.03 },
        { max: 17000, rate: 0.05 },
        { max: Infinity, rate: 0.0575 }
    ];
    const VA_STANDARD_DEDUCTION_2026 = { Single: 8750, MFJ: 17500, HOH: 8750 };
    const OH_NONBUSINESS_RATE_2026 = 0.0275;
    const OH_BUSINESS_RATE = 0.03;
    const OH_BUSINESS_INCOME_DEDUCTION = 250000;

    const STATE_MODULE_METADATA = {
        none: {
            code: 'none',
            name: 'Federal Only',
            taxYear: 2026,
            status: 'not-applicable',
            statusLabel: 'No state selected',
            sources: []
        },
        AZ: {
            code: 'AZ',
            name: 'Arizona',
            taxYear: 2026,
            status: 'legislation-modeled',
            statusLabel: '2026 HB 4168 modeled; ADOR guidance pending',
            sources: [
                'https://www.azleg.gov/legtext/57leg/2R/bills/HB4168H.pdf',
                'https://azdor.gov/forms/individual/individual-income-tax-forms',
                'https://azdor.gov/individuals'
            ]
        },
        CA: {
            code: 'CA',
            name: 'California',
            taxYear: 2026,
            status: 'projected',
            statusLabel: '2026 projected planning estimate',
            sources: [
                'https://www.ftb.ca.gov/forms/index.html',
                'https://www.ftb.ca.gov/file/personal/tax-calculator-tables-rates.asp'
            ]
        },
        CO: {
            code: 'CO',
            name: 'Colorado',
            taxYear: 2026,
            status: 'planning-estimate',
            statusLabel: '2026 focused planning estimate',
            sources: [
                'https://tax.colorado.gov/individual-income-tax-guide',
                'https://tax.colorado.gov/individual-income-tax-forms'
            ]
        },
        VA: {
            code: 'VA',
            name: 'Virginia',
            taxYear: 2026,
            status: 'planning-estimate',
            statusLabel: '2026 focused planning estimate',
            sources: [
                'https://www.tax.virginia.gov/individual-income-tax',
                'https://www.tax.virginia.gov/forms/search?search=760'
            ]
        },
        OH: {
            code: 'OH',
            name: 'Ohio',
            taxYear: 2026,
            status: 'conditional-estimate',
            statusLabel: '2026 state-only estimate; local tax excluded',
            sources: [
                'https://tax.ohio.gov/individual',
                'https://codes.ohio.gov/ohio-revised-code/chapter-5747'
            ]
        }
    };

    function amount(values, key) {
        return Number(values[key]) || 0;
    }

    function calculateProgressiveTax(income, brackets) {
        let tax = 0;
        let previousMax = 0;

        for (const bracket of brackets) {
            if (income <= previousMax) break;
            tax += (Math.min(income, bracket.max) - previousMax) * bracket.rate;
            previousMax = bracket.max;
        }

        return tax;
    }

    function emptyResult(metadata) {
        return {
            ...metadata,
            tax: 0,
            adjustedGrossIncome: 0,
            taxableIncome: 0,
            deduction: 0,
            credits: 0,
            additions: 0,
            subtractions: 0,
            details: {}
        };
    }

    function calculateArizona(context) {
        const {
            values,
            filingStatus,
            isMFJ,
            taxableSS,
            federalAGI,
            federalStandardDeduction,
            deductibleTips = 0,
            deductibleOT = 0,
            seniorBonus = 0
        } = context;
        const govtPensionExclusion = Math.min(isMFJ ? 5000 : 2500, amount(values, 'govtPension'));
        const deduction529 = Math.min(amount(values, 'az529'), isMFJ ? 4000 : 2000);
        const ltcgSubtraction = amount(values, 'azLtcgPost2011') * 0.25;
        const qualifiedTipsSubtraction = Math.max(0, deductibleTips);
        const qualifiedOvertimeSubtraction = Math.max(0, deductibleOT);
        const seniorSubtraction = Math.max(0, seniorBonus);
        const distribution530ASubtraction = amount(values, 'az530ADistributions');
        const dependentCareSubtraction = amount(values, 'azDependentCareExpenseExcess');
        const qualifiedProductionPropertyAddback = amount(values, 'azQualifiedProductionPropertyDepreciation');
        const subtractions = taxableSS + amount(values, 'usGovInterest') + amount(values, 'milPension') +
            govtPensionExclusion + deduction529 + ltcgSubtraction + qualifiedTipsSubtraction +
            qualifiedOvertimeSubtraction + seniorSubtraction + distribution530ASubtraction +
            dependentCareSubtraction;
        const adjustedGrossIncome = federalAGI + qualifiedProductionPropertyAddback - subtractions;
        const charitableStandardIncrease = Math.min(amount(values, 'charity'), isMFJ ? 2000 : 1000);
        const standardDeduction = federalStandardDeduction + charitableStandardIncrease;
        const itemizedSaltDeduction = Math.min(amount(values, 'salt'), 10000);
        const itemizedDeduction = itemizedSaltDeduction + amount(values, 'mortgageInterest') +
            amount(values, 'charity');
        const deduction = Math.max(standardDeduction, itemizedDeduction);
        const taxableIncome = Math.max(0, adjustedGrossIncome - deduction);

        let credits = (amount(values, 'childDependents') * 125) + (amount(values, 'otherDependents') * 25);
        const creditLimit = isMFJ ? 400000 : 200000;
        if (federalAGI >= creditLimit) {
            const reductionSteps = Math.ceil((federalAGI - creditLimit) / 1000);
            credits *= Math.max(0, 1 - (reductionSteps * 0.05));
        }

        return {
            ...STATE_MODULE_METADATA.AZ,
            tax: Math.max(0, (taxableIncome * 0.025) - credits),
            adjustedGrossIncome,
            taxableIncome,
            deduction,
            credits,
            additions: qualifiedProductionPropertyAddback,
            subtractions,
            details: {
                govtPensionExclusion,
                deduction529,
                ltcgSubtraction,
                qualifiedTipsSubtraction,
                qualifiedOvertimeSubtraction,
                seniorSubtraction,
                distribution530ASubtraction,
                dependentCareSubtraction,
                qualifiedProductionPropertyAddback,
                charitableStandardIncrease,
                itemizedSaltDeduction,
                standardDeduction,
                itemizedDeduction,
                taxRate: 0.025,
                filingStatus
            }
        };
    }

    function calculateCalifornia(context) {
        const { values, filingStatus, isMFJ, ageCount, blindCount, taxableSS, federalAGI } = context;
        const additions = amount(values, 'hsaContrib');
        const subtractions = taxableSS + amount(values, 'usGovInterest');
        const adjustedGrossIncome = federalAGI + additions - subtractions;
        const itemizedDeduction = amount(values, 'mortgageInterest') + amount(values, 'charity');
        const deduction = Math.max(CA_STANDARD_DEDUCTION[filingStatus], itemizedDeduction);
        const taxableIncome = Math.max(0, adjustedGrossIncome - deduction);
        const baseTax = calculateProgressiveTax(taxableIncome, CA_BRACKETS_2026[filingStatus]);
        const mentalHealthTax = taxableIncome > 1000000 ? (taxableIncome - 1000000) * 0.01 : 0;
        let credits = CA_EXEMPTION_CREDITS.Personal * (isMFJ ? 2 : 1);
        credits += ageCount * CA_EXEMPTION_CREDITS.Senior;
        credits += blindCount * CA_EXEMPTION_CREDITS.Senior;
        credits += (amount(values, 'childDependents') + amount(values, 'otherDependents')) *
            CA_EXEMPTION_CREDITS.Dependent;

        return {
            ...STATE_MODULE_METADATA.CA,
            tax: Math.max(0, baseTax + mentalHealthTax - credits),
            adjustedGrossIncome,
            taxableIncome,
            deduction,
            credits,
            additions,
            subtractions,
            details: {
                baseTax,
                mentalHealthTax,
                filingStatus
            }
        };
    }

    function calculateColorado(context) {
        const { values, filingStatus, federalTaxableIncome } = context;
        const stateIncomeTaxAddback = amount(values, 'coStateIncomeTaxAddback');
        const retirementSubtraction = amount(values, 'coRetirementSubtraction');
        const deduction529 = amount(values, 'co529Deduction');
        const subtractions = amount(values, 'usGovInterest') + retirementSubtraction + deduction529;
        const adjustedGrossIncome = federalTaxableIncome + stateIncomeTaxAddback - subtractions;
        const taxableIncome = Math.max(0, adjustedGrossIncome);

        return {
            ...STATE_MODULE_METADATA.CO,
            tax: taxableIncome * CO_TAX_RATE_2026,
            adjustedGrossIncome,
            taxableIncome,
            deduction: 0,
            credits: 0,
            additions: stateIncomeTaxAddback,
            subtractions,
            details: {
                startingPoint: federalTaxableIncome,
                startingPointLabel: 'Federal taxable income',
                stateIncomeTaxAddback,
                retirementSubtraction,
                deduction529,
                taxRate: CO_TAX_RATE_2026,
                filingStatus,
                limitations: 'Full-year resident estimate; state credits and specialized additions are not modeled.'
            }
        };
    }

    function calculateVirginia(context) {
        const { values, filingStatus, isMFJ, ageCount, blindCount, taxableSS, federalAGI, usedStandard } = context;
        const militaryRetirementSubtraction = amount(values, 'vaMilitaryRetirement');
        const ageDeduction = amount(values, 'vaAgeDeduction');
        const deduction529 = amount(values, 'va529Deduction');
        const subtractions = taxableSS + amount(values, 'usGovInterest') + militaryRetirementSubtraction +
            ageDeduction + deduction529;
        const adjustedGrossIncome = federalAGI - subtractions;
        const standardDeduction = VA_STANDARD_DEDUCTION_2026[filingStatus];
        const enteredItemizedDeduction = amount(values, 'vaItemizedDeduction');
        const baseDeduction = enteredItemizedDeduction > 0 ? enteredItemizedDeduction : standardDeduction;
        const taxpayerCount = isMFJ ? 2 : 1;
        const dependentCount = amount(values, 'childDependents') + amount(values, 'otherDependents');
        const exemptions = ((taxpayerCount + dependentCount) * 930) + ((ageCount + blindCount) * 800);
        const deduction = baseDeduction + exemptions;
        const taxableIncome = Math.max(0, adjustedGrossIncome - deduction);
        const itemizationReviewRequired = Boolean(usedStandard) === (enteredItemizedDeduction > 0);

        return {
            ...STATE_MODULE_METADATA.VA,
            tax: calculateProgressiveTax(taxableIncome, VA_BRACKETS),
            adjustedGrossIncome,
            taxableIncome,
            deduction,
            credits: 0,
            additions: 0,
            subtractions,
            details: {
                startingPoint: federalAGI,
                startingPointLabel: 'Federal adjusted gross income',
                militaryRetirementSubtraction,
                ageDeduction,
                deduction529,
                standardDeduction,
                enteredItemizedDeduction,
                exemptions,
                itemizationReviewRequired,
                filingStatus,
                limitations: 'Full-year resident estimate; nonrefundable credits and specialized additions are not modeled.'
            }
        };
    }

    function ohioExemptionAmount(federalAGI) {
        if (federalAGI <= 40000) return 2400;
        if (federalAGI <= 80000) return 2150;
        return 1900;
    }

    function calculateOhio(context) {
        const { values, filingStatus, isMFJ, taxableSS, federalAGI, scheduleC } = context;
        const militaryRetirementSubtraction = amount(values, 'ohMilitaryRetirement');
        const deduction529 = amount(values, 'oh529Deduction');
        const baseSubtractions = taxableSS + amount(values, 'usGovInterest') +
            militaryRetirementSubtraction + deduction529;
        const incomeBeforeBusinessDeduction = Math.max(0, federalAGI - baseSubtractions);
        const scheduleCProfit = scheduleC ? scheduleC.totalNetProfit : 0;
        const businessIncome = Math.min(incomeBeforeBusinessDeduction, Math.max(0, scheduleCProfit));
        const businessIncomeDeduction = Math.min(businessIncome, OH_BUSINESS_INCOME_DEDUCTION);
        const taxableBusinessIncome = Math.max(0, businessIncome - businessIncomeDeduction);
        const taxpayerCount = isMFJ ? 2 : 1;
        const dependentCount = amount(values, 'childDependents') + amount(values, 'otherDependents');
        const exemptionPerPerson = ohioExemptionAmount(federalAGI);
        const exemptions = (taxpayerCount + dependentCount) * exemptionPerPerson;
        const taxableNonbusinessIncome = Math.max(
            0,
            incomeBeforeBusinessDeduction - businessIncome - exemptions
        );
        const taxableIncome = taxableNonbusinessIncome + taxableBusinessIncome;
        const nonbusinessTax = taxableNonbusinessIncome * OH_NONBUSINESS_RATE_2026;
        const businessTax = taxableBusinessIncome * OH_BUSINESS_RATE;
        const subtractions = baseSubtractions + businessIncomeDeduction;

        return {
            ...STATE_MODULE_METADATA.OH,
            tax: nonbusinessTax + businessTax,
            adjustedGrossIncome: federalAGI - subtractions,
            taxableIncome,
            deduction: exemptions,
            credits: 0,
            additions: 0,
            subtractions,
            details: {
                startingPoint: federalAGI,
                startingPointLabel: 'Federal adjusted gross income',
                militaryRetirementSubtraction,
                deduction529,
                businessIncome,
                businessIncomeDeduction,
                taxableBusinessIncome,
                taxableNonbusinessIncome,
                exemptions,
                exemptionPerPerson,
                nonbusinessTax,
                businessTax,
                businessReviewRequired: scheduleCProfit !== 0,
                localTaxReviewRequired: true,
                filingStatus,
                limitations: 'Ohio municipal and school-district income taxes are excluded.'
            }
        };
    }

    const STATE_MODULES = {
        none: () => emptyResult(STATE_MODULE_METADATA.none),
        AZ: calculateArizona,
        CA: calculateCalifornia,
        CO: calculateColorado,
        VA: calculateVirginia,
        OH: calculateOhio
    };

    function calculateStateModule(stateCode, context) {
        const normalizedCode = Object.prototype.hasOwnProperty.call(STATE_MODULES, stateCode) ? stateCode : 'none';
        return STATE_MODULES[normalizedCode](context);
    }

    return {
        CA_BRACKETS_2026,
        CA_STANDARD_DEDUCTION,
        CA_EXEMPTION_CREDITS,
        CO_TAX_RATE_2026,
        VA_BRACKETS,
        VA_STANDARD_DEDUCTION_2026,
        OH_NONBUSINESS_RATE_2026,
        OH_BUSINESS_RATE,
        OH_BUSINESS_INCOME_DEDUCTION,
        STATE_MODULE_METADATA,
        calculateStateModule
    };
}));
