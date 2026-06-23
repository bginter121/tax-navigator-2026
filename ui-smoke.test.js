'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const TaxEngine = require('./tax-engine.js');

class MockClassList {
    constructor(className = '') {
        this.values = new Set(className.split(/\s+/).filter(Boolean));
    }

    add(...names) {
        names.forEach(name => this.values.add(name));
    }

    remove(...names) {
        names.forEach(name => this.values.delete(name));
    }

    contains(name) {
        return this.values.has(name);
    }

    toggle(name, force) {
        if (force === true) this.values.add(name);
        else if (force === false) this.values.delete(name);
        else if (this.values.has(name)) this.values.delete(name);
        else this.values.add(name);
        return this.values.has(name);
    }
}

class MockElement {
    constructor({ id = '', tagName = 'div', type = '', value = '', className = '', dataType = '' } = {}) {
        this.id = id;
        this.tagName = tagName.toUpperCase();
        this.type = type;
        this.value = value;
        this.checked = false;
        this.disabled = false;
        this.dataset = dataType ? { type: dataType } : {};
        this.style = {};
        this.listeners = {};
        this.children = [];
        this.textContent = '';
        this.innerHTML = '';
        this._className = className;
        this.classList = new MockClassList(className);
    }

    get className() {
        return this._className;
    }

    set className(value) {
        this._className = value;
        this.classList = new MockClassList(value);
    }

    addEventListener(type, callback) {
        if (!this.listeners[type]) this.listeners[type] = [];
        this.listeners[type].push(callback);
    }

    dispatchEvent(event) {
        (this.listeners[event.type] || []).forEach(callback => callback.call(this, event));
        return true;
    }

    appendChild(child) {
        this.children.push(child);
        return child;
    }

    removeChild(child) {
        this.children = this.children.filter(item => item !== child);
    }

    replaceChildren(...children) {
        this.children = children;
        this.textContent = '';
    }

    click() {}
    select() {}
}

function readAttribute(attributes, name) {
    const match = attributes.match(new RegExp(`\\b${name}="([^"]*)"`, 'i'));
    return match ? match[1] : '';
}

function createPageRuntime() {
    const html = fs.readFileSync('index.html', 'utf8');
    const elements = new Map();
    const elementPattern = /<([a-z0-9]+)([^>]*\bid="[^"]+"[^>]*)>/gi;
    let match;
    while ((match = elementPattern.exec(html))) {
        const tagName = match[1];
        const attributes = match[2];
        const id = readAttribute(attributes, 'id');
        elements.set(id, new MockElement({
            id,
            tagName,
            type: readAttribute(attributes, 'type') || (tagName.toLowerCase() === 'input' ? 'text' : ''),
            value: readAttribute(attributes, 'value'),
            className: readAttribute(attributes, 'class'),
            dataType: readAttribute(attributes, 'data-type')
        }));
    }

    elements.get('filingStatus').value = 'Single';
    elements.get('stateModule').value = 'none';
    elements.get('rothTargetRate').value = 'current';
    elements.get('ltcgTargetRate').value = '0';

    const readyCallbacks = [];
    const document = {
        activeElement: new MockElement({ tagName: 'button' }),
        body: new MockElement({ tagName: 'body' }),
        getElementById: id => elements.get(id) || null,
        querySelectorAll: selector => selector === 'input[data-type="currency"]'
            ? [...elements.values()].filter(element => element.dataset.type === 'currency')
            : [],
        createElement: tagName => new MockElement({ tagName }),
        addEventListener: (type, callback) => {
            if (type === 'DOMContentLoaded') readyCallbacks.push(callback);
        }
    };
    const storage = new Map();
    const localStorage = {
        getItem: key => storage.has(key) ? storage.get(key) : null,
        setItem: (key, value) => storage.set(key, value),
        removeItem: key => storage.delete(key)
    };
    const context = vm.createContext({
        console,
        document,
        localStorage,
        Blob,
        URL,
        FileReader: class {},
        Event: class { constructor(type) { this.type = type; } },
        alert() {},
        setTimeout,
        clearTimeout,
        TaxEngine
    });
    context.window = context;
    context.window.TaxEngine = TaxEngine;

    const inlineScripts = [...html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/gi)]
        .map(scriptMatch => scriptMatch[1])
        .filter(Boolean);
    vm.runInContext(inlineScripts.at(-1), context);
    readyCallbacks.forEach(callback => callback());

    return { context, elements };
}

test('captures, compares, restores, and applies a Roth conversion plan', () => {
    const { context, elements } = createPageRuntime();
    elements.get('wages').value = '100000';
    context.calculateTax();

    context.captureBaselineScenario();
    assert.equal(elements.get('scenarioComparisonCard').classList.contains('hidden'), false);
    assert.match(elements.get('baselineStatus').textContent, /captured/i);
    assert.equal(elements.get('rothRoomValue').textContent, '$21,800');

    elements.get('iraRothConv').value = '10000';
    context.calculateTax();
    assert.notEqual(elements.get('comparisonCombinedDelta').textContent, '$0');
    assert.ok(elements.get('comparisonChanges').children.length > 0);

    context.restoreBaselineScenario();
    assert.equal(elements.get('iraRothConv').value, '0');

    context.applyRothConversionRoom();
    assert.equal(elements.get('iraRothConv').value, '21,800');
});

test('models and applies gain room in the 0% LTCG band', () => {
    const { context, elements } = createPageRuntime();
    elements.get('wages').value = '40000';
    context.calculateTax();

    assert.equal(elements.get('ltcgRoomValue').textContent, '$25,550');
    assert.equal(elements.get('ltcgDirectTaxCost').textContent, '$0');
    assert.match(elements.get('ltcgInsightText').textContent, /no direct LTCG tax/i);

    context.applyCapitalGainRoom();
    assert.equal(elements.get('ltcg').value, '25,550');
});

test('warns when a 0% LTCG harvest makes more Social Security taxable', () => {
    const { context, elements } = createPageRuntime();
    elements.get('socialSecurity').value = '30000';
    elements.get('iraRegular').value = '20000';
    context.calculateTax();

    assert.equal(elements.get('ltcgDirectTaxCost').textContent, '$0');
    assert.notEqual(elements.get('ltcgTaxableSSIncrease').textContent, '+$0');
    assert.match(elements.get('ltcgInsightText').textContent, /0% LTCG band.*Social Security becomes taxable/i);
});

test('projects 2026 Social Security from the 2025 benefit amount', () => {
    const { context, elements } = createPageRuntime();
    elements.get('socialSecurity2025Amount').value = '30000';

    context.applySocialSecurityCola();

    assert.equal(elements.get('socialSecurity').value, '30,840');
    assert.equal(context.readFormValues().socialSecurity, 30840);
    assert.match(elements.get('socialSecurityColaResult').textContent, /2025 \$30,000 x 1\.028 = 2026 \$30,840/);
});

test('adds, compares, and removes a Schedule C business', () => {
    const { context, elements } = createPageRuntime();
    assert.equal(elements.get('extraFederalTaxSummary').classList.contains('hidden'), true);
    context.addScheduleCBusiness();
    const businessId = context.readFormValues().scheduleCBusinesses[0].id;
    context.updateScheduleCBusiness(businessId, 'grossReceipts', '100000');
    context.updateScheduleCBusiness(businessId, 'totalExpenses', '20000');

    assert.equal(elements.get('scheduleCResultCard').classList.contains('hidden'), false);
    assert.equal(elements.get('scheduleCNetProfit').textContent, '$80,000');
    assert.notEqual(elements.get('displaySelfEmploymentTax').textContent, '$0');
    assert.notEqual(elements.get('displayIncomeTax').textContent, elements.get('displayTotalTax').textContent);
    assert.equal(elements.get('extraFederalTaxSummary').classList.contains('hidden'), false);

    context.captureBaselineScenario();
    context.updateScheduleCBusiness(businessId, 'totalExpenses', '30000');
    assert.ok(elements.get('comparisonChanges').children.some(child => /Schedule C businesses changed/.test(child.textContent)));

    context.removeScheduleCBusiness(businessId);
    assert.equal(elements.get('scheduleCResultCard').classList.contains('hidden'), true);
    assert.equal(elements.get('extraFederalTaxSummary').classList.contains('hidden'), true);
});

test('keeps the Schedule C card planning-focused', () => {
    const { context, elements } = createPageRuntime();
    context.addScheduleCBusiness();
    const scheduleCHtml = elements.get('scheduleCBusinessList').innerHTML;

    assert.match(scheduleCHtml, /Business Income/);
    assert.match(scheduleCHtml, /Business Expenses/);
    assert.match(scheduleCHtml, /Primary Client/);
    assert.match(scheduleCHtml, /Qualified Tips Included in Business Income/);
    assert.doesNotMatch(scheduleCHtml, /Returns \/ Allowances/);
    assert.doesNotMatch(scheduleCHtml, /Cost of Goods Sold/);
    assert.doesNotMatch(scheduleCHtml, /Other Income/);
});

test('explains Schedule C owner W-2 wage coordination', () => {
    const html = fs.readFileSync('index.html', 'utf8');
    assert.match(html, /id="seWageCoordinationInfo"/);
    assert.match(html, /Primary Client[\s\S]*id="seWageCoordinationInfo"/);
    assert.match(html, /border-violet-200 shadow-sm overflow-visible/);
    assert.match(html, /W-2 Box 3:[\s\S]*Social Security wages/);
    assert.match(html, /W-2 Box 5:[\s\S]*Medicare wages and tips/);
    assert.match(html, /Do not enter W-2 Box 1 wages here/);
});

test('includes advisor guidance for Social Security COLA projection', () => {
    const html = fs.readFileSync('index.html', 'utf8');
    assert.match(html, /id="socialSecurityColaInfo"/);
    assert.match(html, /Apply 2\.8% COLA to 2026/);
    assert.match(html, /Form 1040 line 6a/);
    assert.match(html, /not taxable Social Security from line 6b/);
});

test('shows Medicare IRMAA watch for Medicare-age clients', () => {
    const { context, elements } = createPageRuntime();
    assert.equal(elements.get('irmaaWatchCard').classList.contains('hidden'), true);

    elements.get('ageSelf').value = '67';
    elements.get('wages').value = '150000';
    elements.get('irmaa2024Agi').value = '110000';
    elements.get('irmaa2024TaxExemptInterest').value = '1000';
    elements.get('irmaaProjectedTaxExemptInterest').value = '2000';
    context.calculateTax();

    assert.equal(elements.get('irmaaWatchCard').classList.contains('hidden'), false);
    assert.equal(elements.get('irmaaEnrolleeBadge').textContent, '1 Medicare enrollee');
    assert.equal(elements.get('irmaaActualMagi').textContent, '$111,000');
    assert.equal(elements.get('irmaaActualStatus').textContent, 'IRMAA tier 1');
    assert.equal(elements.get('irmaaActualMonthly').textContent, '$95.70 / person');
    assert.equal(elements.get('irmaaProjectedMagi').textContent, '$152,000');
    assert.equal(elements.get('irmaaProjectedStatus').textContent, 'Current-dollar tier 2');

    const roundTrip = context.readFormValues();
    assert.equal(roundTrip.irmaa2024Agi, 110000);
    assert.equal(roundTrip.irmaa2024TaxExemptInterest, 1000);
    assert.equal(roundTrip.irmaaProjectedTaxExemptInterest, 2000);
});

test('includes advisor guidance for IRMAA inputs', () => {
    const html = fs.readFileSync('index.html', 'utf8');
    assert.match(html, /id="irmaaInfo"/);
    assert.match(html, /2026 IRMAA uses the 2024 return/);
    assert.match(html, /Form 1040 line 11/);
    assert.match(html, /Form 1040 line 2a/);
    assert.match(html, /2026 IRMAA monthly add-ons/);
    assert.match(html, /Tier 2[\s\S]*\$202\.90[\s\S]*\$37\.50[\s\S]*\$240\.40/);
    assert.match(html, /Tier 3[\s\S]*\$324\.60[\s\S]*\$60\.40[\s\S]*\$385\.00/);
    assert.match(html, /Married filing separately while living with a spouse/);
    assert.match(html, /Source: SSA Form SSA-44/);
});

test('migrates legacy employee tips and preserves nested Schedule C values', () => {
    const { context, elements } = createPageRuntime();
    context.addScheduleCBusiness();
    const values = context.readFormValues();
    values.tips = 5000;
    delete values.employeeQualifiedTips;
    values.scheduleCBusinesses[0].grossReceipts = 25000;
    context.writeFormValues(values);

    const roundTrip = context.readFormValues();
    assert.equal(elements.get('employeeQualifiedTips').value, '5,000');
    assert.equal(roundTrip.scheduleCBusinesses[0].grossReceipts, 25000);
});

test('round-trips Tennessee and South Carolina client values', () => {
    const { context, elements } = createPageRuntime();
    context.writeFormValues({
        stateModule: 'SC',
        scStateIncomeTaxAddback: 2500,
        scRetirementIncomeDeduction: 10000,
        scAge65Deduction: 5000,
        scMilitaryRetirementDeduction: 12000,
        sc529Deduction: 3000
    });

    const roundTrip = context.readFormValues();
    assert.equal(roundTrip.stateModule, 'SC');
    assert.equal(roundTrip.scStateIncomeTaxAddback, 2500);
    assert.equal(roundTrip.scRetirementIncomeDeduction, 10000);
    assert.equal(roundTrip.scAge65Deduction, 5000);
    assert.equal(roundTrip.scMilitaryRetirementDeduction, 12000);
    assert.equal(roundTrip.sc529Deduction, 3000);

    context.writeFormValues({ ...roundTrip, stateModule: 'TN' });
    assert.equal(elements.get('stateModule').value, 'TN');
});

test('pauses strategy analyzers when a probe reaches the QBI guardrail', () => {
    const { context, elements } = createPageRuntime();
    elements.get('wages').value = '130000';
    context.addScheduleCBusiness();
    const businessId = context.readFormValues().scheduleCBusinesses[0].id;
    context.updateScheduleCBusiness(businessId, 'grossReceipts', '30000');

    assert.equal(elements.get('rothRoomValue').textContent, 'Review Required');
    assert.equal(elements.get('rothQbiWarning').classList.contains('hidden'), false);
    assert.equal(elements.get('applyRothRoomButton').disabled, true);
});

test('shows Arizona HB 4168 automatic and entered adjustments', () => {
    const { context, elements } = createPageRuntime();
    elements.get('stateModule').value = 'AZ';
    elements.get('wages').value = '90000';
    elements.get('employeeQualifiedTips').value = '10000';
    elements.get('ageSelf').value = '65';
    elements.get('az530ADistributions').value = '2000';
    elements.get('azDependentCareExpenseExcess').value = '1000';
    elements.get('azQualifiedProductionPropertyDepreciation').value = '3000';
    context.calculateTax();

    assert.match(elements.get('azModuleStatus').textContent, /HB 4168 modeled/i);
    assert.equal(elements.get('rowAzSubTips').style.display, 'flex');
    assert.equal(elements.get('rowAzSubSenior').style.display, 'flex');
    assert.equal(elements.get('rowAzSub530A').style.display, 'flex');
    assert.equal(elements.get('rowAzSubDependentCare').style.display, 'flex');
    assert.equal(elements.get('rowAzProductionAddback').style.display, 'flex');
    assert.equal(context.readFormValues().az530ADistributions, 2000);
});

test('includes advisor guidance for IRC 530A distributions', () => {
    const html = fs.readFileSync('index.html', 'utf8');

    assert.match(html, /id="az530AInfoButton"/);
    assert.match(html, /id="az530AInfoPanel" role="note"/);
    assert.match(html, /Enter only the portion of an actual 2026 distribution that is included in federal AGI/);
    assert.match(html, /Do not enter contributions, the account balance, or earnings that stayed in the account/);
    assert.match(html, /Arizona's 2026 forms and administrative guidance are still pending/);
});

test('renders focused state estimates and state-specific guardrails', () => {
    const { context, elements } = createPageRuntime();

    elements.get('stateModule').value = 'CO';
    elements.get('wages').value = '100000';
    elements.get('coRetirementSubtraction').value = '10000';
    context.calculateTax();
    assert.equal(elements.get('planningStateCard').classList.contains('hidden'), false);
    assert.equal(elements.get('coPlanningInputs').classList.contains('hidden'), false);
    assert.match(elements.get('planningStateCardTitle').textContent, /Colorado State Tax/);
    assert.notEqual(elements.get('displayPlanningStateTax').textContent, '$0');

    elements.get('stateModule').value = 'VA';
    elements.get('vaItemizedDeduction').value = '';
    elements.get('salt').value = '30000';
    elements.get('mortgageInterest').value = '20000';
    context.calculateTax();
    assert.equal(elements.get('vaPlanningInputs').classList.contains('hidden'), false);
    assert.match(elements.get('planningStateReviewAlert').textContent, /Virginia requires the state deduction method/i);

    elements.get('stateModule').value = 'OH';
    elements.get('salt').value = '';
    elements.get('mortgageInterest').value = '';
    context.calculateTax();
    assert.equal(elements.get('ohPlanningInputs').classList.contains('hidden'), false);
    assert.match(elements.get('planningStateReviewAlert').textContent, /municipal and school-district/i);
    assert.match(elements.get('planningStateModuleStatus').textContent, /local tax excluded/i);

    context.addScheduleCBusiness();
    const businessId = context.readFormValues().scheduleCBusinesses[0].id;
    context.updateScheduleCBusiness(businessId, 'grossReceipts', '100000');
    assert.match(elements.get('planningStateReviewAlert').textContent, /business estimate uses Schedule C profit only/i);

    elements.get('stateModule').value = 'TN';
    context.calculateTax();
    assert.equal(elements.get('tnPlanningInputs').classList.contains('hidden'), false);
    assert.equal(elements.get('displayPlanningStateTax').textContent, '$0');
    assert.match(elements.get('planningStateModuleStatus').textContent, /no Tennessee individual income tax/i);
    assert.match(elements.get('planningStateReviewAlert').textContent, /separate franchise, excise, business, or local tax/i);

    elements.get('stateModule').value = 'SC';
    elements.get('ltcg').value = '20000';
    elements.get('scRetirementIncomeDeduction').value = '3000';
    context.calculateTax();
    assert.equal(elements.get('scPlanningInputs').classList.contains('hidden'), false);
    assert.match(elements.get('planningStateModuleStatus').textContent, /revalidation required/i);
    assert.match(elements.get('planningStateBusinessLabel').textContent, /SC Capital Gain Deduction/i);
    assert.match(elements.get('planningStateReviewAlert').textContent, /Form I-335 review/i);
    assert.match(elements.get('planningStateReviewAlert').textContent, /2026 IRC conformity/i);
});
