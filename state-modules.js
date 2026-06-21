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
            status: 'projected',
            statusLabel: '2026 projected planning estimate',
            sources: [
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
        const { values, filingStatus, isMFJ, taxableSS, federalAGI, federalStandardDeduction } = context;
        const govtPensionExclusion = Math.min(isMFJ ? 5000 : 2500, amount(values, 'govtPension'));
        const deduction529 = Math.min(amount(values, 'az529'), isMFJ ? 4000 : 2000);
        const ltcgSubtraction = amount(values, 'azLtcgPost2011') * 0.25;
        const subtractions = taxableSS + amount(values, 'usGovInterest') + amount(values, 'milPension') +
            govtPensionExclusion + deduction529 + ltcgSubtraction;
        const adjustedGrossIncome = federalAGI - subtractions;
        const standardDeduction = federalStandardDeduction + (amount(values, 'charity') * 0.34);
        const itemizedDeduction = amount(values, 'mortgageInterest') + amount(values, 'charity');
        const deduction = Math.max(standardDeduction, itemizedDeduction);
        const taxableIncome = Math.max(0, adjustedGrossIncome - deduction);

        let credits = (amount(values, 'childDependents') * 100) + (amount(values, 'otherDependents') * 25);
        const creditLimit = isMFJ ? 400000 : 200000;
        if (federalAGI > creditLimit) {
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
            additions: 0,
            subtractions,
            details: {
                govtPensionExclusion,
                deduction529,
                ltcgSubtraction,
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

    const STATE_MODULES = {
        none: () => emptyResult(STATE_MODULE_METADATA.none),
        AZ: calculateArizona,
        CA: calculateCalifornia
    };

    function calculateStateModule(stateCode, context) {
        const normalizedCode = Object.prototype.hasOwnProperty.call(STATE_MODULES, stateCode) ? stateCode : 'none';
        return STATE_MODULES[normalizedCode](context);
    }

    return {
        CA_BRACKETS_2026,
        CA_STANDARD_DEDUCTION,
        CA_EXEMPTION_CREDITS,
        STATE_MODULE_METADATA,
        calculateStateModule
    };
}));
