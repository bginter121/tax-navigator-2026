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
