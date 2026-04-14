/**
 * Advanced Calculator — Full Mathematics Suite
 *
 * Supports:
 *   • Arithmetic, exponents, roots, factorials
 *   • Trigonometry (degrees by default; use sinr/cosr/tanr for radians)
 *   • Logarithms (log = base-10, ln = natural, log2 = base-2)
 *   • Statistics — mean, median, mode, variance, std, range, sum
 *   • Number theory — GCD, LCM, prime check, prime factorization
 *   • Combinatorics — nCr, nPr, n!
 *   • Equation solving — linear, quadratic (with steps), cubic (numerical)
 *   • System of 2 linear equations
 *   • Percentage — "15% of 200", "200 + 15%"
 *   • Constants — PI, E, PHI (golden ratio)
 */

// ── Math helpers ──────────────────────────────────────────────────────────────
const DEG = Math.PI / 180;
const RAD = 180 / Math.PI;

function factorial(n) {
    n = Math.floor(n);
    if (n < 0)  throw new Error('Factorial of negative number');
    if (n > 170) throw new Error('Number too large for factorial');
    let r = 1;
    for (let i = 2; i <= n; i++) r *= i;
    return r;
}
function combinations(n, r) {
    if (r < 0 || r > n) return 0;
    return factorial(n) / (factorial(r) * factorial(n - r));
}
function permutations(n, r) {
    if (r < 0 || r > n) return 0;
    return factorial(n) / factorial(n - r);
}
function gcd(a, b) {
    a = Math.abs(Math.round(a)); b = Math.abs(Math.round(b));
    while (b) { [a, b] = [b, a % b]; }
    return a;
}
function lcm(a, b) {
    return Math.abs(a * b) / gcd(a, b);
}
function fmt(n, dp = 10) {
    if (!isFinite(n)) return String(n);
    const s = parseFloat(n.toFixed(dp));
    return String(s);
}

// ── Safe expression evaluator ─────────────────────────────────────────────────
const MATH_FNS = {
    // Constants
    PI: Math.PI, E: Math.E, PHI: 1.618033988749895, TAU: 2 * Math.PI,
    // Trig — degrees (default)
    sin:  d => Math.sin(d * DEG),
    cos:  d => Math.cos(d * DEG),
    tan:  d => Math.tan(d * DEG),
    cot:  d => 1 / Math.tan(d * DEG),
    sec:  d => 1 / Math.cos(d * DEG),
    csc:  d => 1 / Math.sin(d * DEG),
    asin: x => Math.asin(x) * RAD,
    acos: x => Math.acos(x) * RAD,
    atan: x => Math.atan(x) * RAD,
    atan2:(y,x)=>Math.atan2(y,x)*RAD,
    // Trig — radians (suffix r)
    sinr: Math.sin, cosr: Math.cos, tanr: Math.tan,
    asinr: Math.asin, acosr: Math.acos, atanr: Math.atan,
    // Hyperbolic
    sinh: Math.sinh, cosh: Math.cosh, tanh: Math.tanh,
    asinh: Math.asinh, acosh: Math.acosh, atanh: Math.atanh,
    // Roots & powers
    sqrt: Math.sqrt, cbrt: Math.cbrt, pow: Math.pow, exp: Math.exp,
    // Logarithms
    log:   Math.log10, log10: Math.log10, log2: Math.log2, ln: Math.log,
    logb:  (x, b) => Math.log(x) / Math.log(b),
    // Rounding
    abs: Math.abs, floor: Math.floor, ceil: Math.ceil,
    round: Math.round, sign: Math.sign, trunc: Math.trunc,
    // Multi-arg
    max: (...a) => Math.max(...a), min: (...a) => Math.min(...a),
    hypot: Math.hypot,
    // Combinatorics (callable inside expressions)
    factorial, C: combinations, nCr: combinations, P: permutations, nPr: permutations,
    // Number theory
    gcd, lcm,
    // Stats (variadic — e.g. mean(1,2,3,4,5))
    mean:    (...a) => a.flat().reduce((s,v)=>s+v,0)/a.flat().length,
    sum:     (...a) => a.flat().reduce((s,v)=>s+v,0),
    product: (...a) => a.flat().reduce((s,v)=>s*v,1),
    // Misc
    mod: (a,b) => ((a % b) + b) % b,
    deg: r => r * RAD,
    rad: d => d * DEG,
};

function evalExpr(expr) {
    // Preprocessing — convert common math notation to JS
    let e = expr
        .replace(/[×x]/g, '*').replace(/[÷]/g, '/')
        .replace(/[–—]/g, '-')
        .replace(/²/g, '**2').replace(/³/g, '**3').replace(/⁴/g, '**4')
        .replace(/\^/g, '**')
        .replace(/√\(/g, 'sqrt(').replace(/√(\d+)/g, 'sqrt($1)')
        .replace(/∛\(/g, 'cbrt(').replace(/∛(\d+)/g, 'cbrt($1)')
        .replace(/π/g, 'PI').replace(/\bpi\b/gi, 'PI')
        .replace(/\bphi\b/gi, 'PHI')
        .replace(/\binf(inity)?\b/gi, 'Infinity')
        // factorial: 5! → factorial(5)
        .replace(/(\w+)!/g, 'factorial($1)')
        // implicit multiplication: 2PI → 2*PI, 2sqrt → 2*sqrt, 3( → 3*(
        .replace(/(\d)(PI|E\b|PHI|TAU)/g, '$1*$2')
        .replace(/(\d)\s*\(/g, '$1*(')
        .replace(/\)\s*\(/g, ')*(')
        // nCr / nPr shorthand: 8C3 → C(8,3)
        .replace(/(\d+)\s*C\s*(\d+)/g, 'C($1,$2)')
        .replace(/(\d+)\s*P\s*(\d+)/g, 'P($1,$2)');

    const fn = new Function(...Object.keys(MATH_FNS), `"use strict"; return (${e});`);
    return fn(...Object.values(MATH_FNS));
}

// ── Router ────────────────────────────────────────────────────────────────────
function route(raw) {
    const low = raw.toLowerCase().trim();

    // Percentage — "15% of 200"
    if (/\d+(\.\d+)?%\s+of\s+\d/.test(low)) return calcPercentageOf(low);
    // "200 + 15%" or "200 - 15%"
    if (/\d\s*[+\-]\s*\d+(\.\d+)?%/.test(low)) return calcPercentageDelta(low);

    // Statistics (keyword as standalone command)
    const statMatch = low.match(/^(mean|median|mode|std|stddev|variance|var|range|sum|product)\s*\(?([\d\s,.\-]+)\)?/);
    if (statMatch) return calcStats(statMatch[1], statMatch[2]);

    // GCD / LCM
    const gcdMatch = low.match(/^(gcd|lcm)\s*[\s(,]\s*([\d\s,]+)/);
    if (gcdMatch) return calcGcdLcm(gcdMatch[1], gcdMatch[2]);

    // Prime / Factor
    if (/^(prime|isprime)\s+(\d+)/.test(low)) {
        const n = parseInt(low.match(/\d+/)[0]);
        return calcPrime(n);
    }
    if (/^(factor|factors|factorise|factorize)\s+(\d+)/.test(low)) {
        const n = parseInt(low.match(/\d+/)[0]);
        return calcFactor(n);
    }

    // System of 2 equations: "2x+y=7, x-y=1" or "2x+y=7\nx-y=1"
    const eqParts = raw.split(/[,\n;]/);
    if (eqParts.length >= 2 && eqParts.every(p => p.includes('='))) {
        return solveSystem(eqParts[0].trim(), eqParts[1].trim(), raw);
    }

    // Single equation (contains = and a letter variable)
    if (raw.includes('=') && /[a-zA-Z]/.test(raw)) {
        return solveEquation(raw);
    }

    // Pure expression
    return calcExpression(raw);
}

// ── Expression evaluator ──────────────────────────────────────────────────────
function calcExpression(raw) {
    let result;
    try {
        result = evalExpr(raw);
    } catch (err) {
        throw new Error(`Cannot evaluate "${raw}": ${err.message}`);
    }

    if (typeof result === 'boolean') result = result ? 1 : 0;
    if (!isFinite(result) && result !== Infinity && result !== -Infinity) {
        throw new Error('Result is undefined (division by zero or invalid operation)');
    }

    return (
        `🧮 *Calculator Result*\n\n` +
        `📝 *Expression:* \`${raw}\`\n` +
        `✅ *Result:* \`${fmt(result)}\``
    );
}

// ── Statistics ────────────────────────────────────────────────────────────────
function calcStats(fn, numStr) {
    const nums = numStr.split(/[\s,]+/).map(Number).filter(n => !isNaN(n));
    if (!nums.length) throw new Error('No valid numbers provided');

    const n    = nums.length;
    const mean = nums.reduce((a, b) => a + b, 0) / n;
    const sorted = [...nums].sort((a, b) => a - b);
    const med  = n % 2 ? sorted[Math.floor(n/2)] : (sorted[n/2-1] + sorted[n/2]) / 2;
    const variance = nums.reduce((s, v) => s + (v - mean) ** 2, 0) / n;
    const std  = Math.sqrt(variance);
    const sum  = nums.reduce((a, b) => a + b, 0);
    const range = sorted[n-1] - sorted[0];

    // Mode
    const freq = {}; nums.forEach(v => freq[v] = (freq[v]||0)+1);
    const maxF = Math.max(...Object.values(freq));
    const mode = Object.keys(freq).filter(k => freq[k] === maxF).map(Number);

    const results = {
        mean: fmt(mean), median: fmt(med),
        mode: mode.join(', '), variance: fmt(variance), std: fmt(std),
        sum: fmt(sum), range: fmt(range),
        min: fmt(sorted[0]), max: fmt(sorted[n-1]), count: n,
    };

    const pick = (f) => {
        switch (f) {
            case 'mean':    return `✅ *Mean:* \`${results.mean}\``;
            case 'median':  return `✅ *Median:* \`${results.median}\``;
            case 'mode':    return `✅ *Mode:* \`${results.mode}\``;
            case 'std': case 'stddev':
                            return `✅ *Std Dev:* \`${results.std}\``;
            case 'variance': case 'var':
                            return `✅ *Variance:* \`${results.variance}\``;
            case 'range':   return `✅ *Range:* \`${results.range}\``;
            case 'sum':     return `✅ *Sum:* \`${results.sum}\``;
            case 'product': return `✅ *Product:* \`${fmt(nums.reduce((a,b)=>a*b,1))}\``;
        }
        return null;
    };

    const specific = pick(fn);
    const dataLine = `📊 *Data:* \`${nums.join(', ')}\` (n = ${n})`;

    if (specific) {
        return `📊 *Statistics*\n\n${dataLine}\n${specific}`;
    }

    return (
        `📊 *Full Statistics*\n\n` +
        `${dataLine}\n` +
        `━━━━━━━━━━━━━━━━━━━━━\n` +
        `📌 Count    : ${n}\n` +
        `📌 Sum      : ${results.sum}\n` +
        `📌 Mean     : ${results.mean}\n` +
        `📌 Median   : ${results.median}\n` +
        `📌 Mode     : ${results.mode}\n` +
        `📌 Std Dev  : ${results.std}\n` +
        `📌 Variance : ${results.variance}\n` +
        `📌 Range    : ${results.range}\n` +
        `📌 Min      : ${results.min}\n` +
        `📌 Max      : ${results.max}`
    );
}

// ── GCD / LCM ─────────────────────────────────────────────────────────────────
function calcGcdLcm(fn, numStr) {
    const nums = numStr.split(/[\s,]+/).map(Number).filter(n => !isNaN(n) && n > 0);
    if (nums.length < 2) throw new Error('Provide at least 2 numbers');
    if (fn === 'gcd') {
        const result = nums.reduce((a, b) => gcd(a, b));
        return `🔢 *GCD*\n\n📝 Numbers: \`${nums.join(', ')}\`\n✅ GCD = \`${result}\``;
    }
    const result = nums.reduce((a, b) => lcm(a, b));
    return `🔢 *LCM*\n\n📝 Numbers: \`${nums.join(', ')}\`\n✅ LCM = \`${result}\``;
}

// ── Prime factorization ───────────────────────────────────────────────────────
function primeFactors(n) {
    const factors = [];
    let d = 2;
    while (d * d <= n) {
        while (n % d === 0) { factors.push(d); n = Math.floor(n / d); }
        d++;
    }
    if (n > 1) factors.push(n);
    return factors;
}
function isPrime(n) {
    if (n < 2) return false;
    if (n === 2) return true;
    if (n % 2 === 0) return false;
    for (let i = 3; i <= Math.sqrt(n); i += 2) if (n % i === 0) return false;
    return true;
}
function calcPrime(n) {
    n = Math.floor(Math.abs(n));
    const prime = isPrime(n);
    return (
        `🔢 *Prime Check*\n\n` +
        `📝 Number: \`${n}\`\n` +
        `✅ *${n} is ${prime ? '' : 'NOT '}a prime number*` +
        (prime ? '' : `\n💡 Smallest factor: \`${primeFactors(n)[0]}\``)
    );
}
function calcFactor(n) {
    n = Math.floor(Math.abs(n));
    if (n < 2) throw new Error('Enter a number ≥ 2');
    const factors = primeFactors(n);
    // Group as powers
    const count = {};
    factors.forEach(f => count[f] = (count[f]||0)+1);
    const expr = Object.entries(count).map(([p,e]) => e > 1 ? `${p}^${e}` : p).join(' × ');
    const divs = [];
    for (let i = 1; i <= n; i++) if (n % i === 0) divs.push(i);
    return (
        `🔢 *Prime Factorization*\n\n` +
        `📝 Number: \`${n}\`\n` +
        `✅ *${n} = ${expr}*\n` +
        `📌 All factors: \`${divs.join(', ')}\`\n` +
        `📌 Factor count: ${divs.length}`
    );
}

// ── Percentage ────────────────────────────────────────────────────────────────
function calcPercentageOf(str) {
    const m = str.match(/([\d.]+)%\s+of\s+([\d.]+)/i);
    if (!m) throw new Error('Format: 15% of 200');
    const pct = parseFloat(m[1]), val = parseFloat(m[2]);
    const result = (pct / 100) * val;
    return (
        `💯 *Percentage*\n\n` +
        `\`${pct}% of ${val}\`\n` +
        `= \`${pct}/100 × ${val}\`\n` +
        `✅ = \`${fmt(result)}\``
    );
}
function calcPercentageDelta(str) {
    const m = str.match(/([\d.]+)\s*([+\-])\s*([\d.]+)%/);
    if (!m) throw new Error('Format: 200 + 15%  or  200 - 15%');
    const base = parseFloat(m[1]), op = m[2], pct = parseFloat(m[3]);
    const delta = (pct / 100) * base;
    const result = op === '+' ? base + delta : base - delta;
    return (
        `💯 *Percentage ${op === '+' ? 'Increase' : 'Decrease'}*\n\n` +
        `Base: \`${base}\`\n` +
        `${op === '+' ? 'Increase' : 'Decrease'}: \`${pct}% = ${fmt(delta)}\`\n` +
        `✅ Result: \`${fmt(result)}\``
    );
}

// ── Equation solving ──────────────────────────────────────────────────────────
function solveEquation(raw) {
    let eq = raw
        .replace(/²/g, '^2').replace(/³/g, '^3')
        .replace(/\s+/g, '').toLowerCase();

    // Determine degree
    const isCubic = /x\^3|x³/.test(eq);
    const isQuad  = /x\^2|x²/.test(eq);

    // Move RHS to LHS: ax + c = d → ax + c - d = 0
    if (eq.includes('=')) {
        const [lhs, rhs] = eq.split('=');
        const rhsVal = rhs === '' ? NaN : (() => {
            try { return evalExpr(rhs.replace(/x/g, '0')); } catch { return NaN; }
        })();
        if (isNaN(rhsVal)) throw new Error('Cannot parse right-hand side');
        eq = rhsVal === 0 ? lhs : `(${lhs})-(${rhsVal})`;
    }

    if (isCubic) return solveCubic(eq, raw);
    if (isQuad)  return solveQuadratic(eq, raw);
    return solveLinear(eq, raw);
}

function extractQuadCoeffs(expr) {
    let e = expr.replace(/\^2/g, '²').replace(/([0-9])x/g, '$1*x');
    let a = 0, b = 0, c = 0, isQuad = false, m;

    const qRe = /([+-]?\d*\.?\d*)\*?x²/g;
    while ((m = qRe.exec(e)) !== null) {
        const k = m[1];
        a += (k === '' || k === '+') ? 1 : k === '-' ? -1 : parseFloat(k);
        isQuad = true;
    }
    const lRe = /([+-]?\d*\.?\d*)\*?x(?!²)/g;
    while ((m = lRe.exec(e)) !== null) {
        const k = m[1];
        b += (k === '' || k === '+') ? 1 : k === '-' ? -1 : parseFloat(k);
    }
    let rest = e.replace(/[+-]?\d*\.?\d*\*?x²/g,'').replace(/[+-]?\d*\.?\d*\*?x(?!²)/g,'').replace(/[()]/g,'');
    try { c = rest ? parseFloat(Function(`"use strict";return(${rest})`)()) : 0; } catch { c = 0; }
    return { a, b, c, isQuad };
}

function solveLinear(expr, original) {
    let b = 0, c = 0, m;
    const e = expr.replace(/([0-9])x/g, '$1*x');
    const lRe = /([+-]?\d*\.?\d*)\*?x/g;
    while ((m = lRe.exec(e)) !== null) {
        const k = m[1];
        b += (k===''||k==='+') ? 1 : k==='-' ? -1 : parseFloat(k);
    }
    let rest = e.replace(/[+-]?\d*\.?\d*\*?x/g,'').replace(/[()]/g,'');
    try { c = rest ? parseFloat(Function(`"use strict";return(${rest})`)()) : 0; } catch { c = 0; }

    if (b === 0) throw new Error('No variable found — enter as: 2x + 5 = 0');
    const x = -c / b;
    return (
        `🧮 *Linear Equation*\n\n📝 \`${original}\`\n` +
        `━━━━━━━━━━━━━━━━━━━━━\n` +
        `*Step 1 — Standard form:* \`bx + c = 0\`\n` +
        `b = ${fmt(b)},  c = ${fmt(c)}\n\n` +
        `*Step 2 — Isolate x*\n` +
        `\`${fmt(b)}x = ${fmt(-c)}\`\n` +
        `\`x = ${fmt(-c)} ÷ ${fmt(b)}\`\n\n` +
        `✅ *x = ${fmt(x)}*`
    );
}

function solveQuadratic(expr, original) {
    const { a, b, c } = extractQuadCoeffs(expr);
    const disc = b*b - 4*a*c;
    const h = -b / (2*a), k = c - (b*b)/(4*a);

    let text =
        `🧮 *Quadratic Equation*\n\n📝 \`${original}\`\n` +
        `━━━━━━━━━━━━━━━━━━━━━\n` +
        `*Step 1 — Standard form:* ax² + bx + c = 0\n` +
        `a = ${fmt(a)},  b = ${fmt(b)},  c = ${fmt(c)}\n\n` +
        `*Step 2 — Discriminant (Δ = b² − 4ac)*\n` +
        `Δ = (${fmt(b)})² − 4(${fmt(a)})(${fmt(c)})\n` +
        `Δ = ${fmt(b*b)} − ${fmt(4*a*c)} = *${fmt(disc)}*\n\n` +
        `*Step 3 — Roots: x = (−b ± √Δ) / 2a*\n\n`;

    if (disc > 0) {
        const sq = Math.sqrt(disc);
        const x1 = (-b + sq) / (2*a), x2 = (-b - sq) / (2*a);
        text += `Δ > 0 → *Two distinct real roots*\n`;
        text += `x₁ = (${fmt(-b)} + ${fmt(sq)}) / ${fmt(2*a)} = *${fmt(x1)}*\n`;
        text += `x₂ = (${fmt(-b)} − ${fmt(sq)}) / ${fmt(2*a)} = *${fmt(x2)}*\n\n`;
        text += `*Step 4 — Factored form*\n`;
        text += `${fmt(a)}(x − ${fmt(x1)})(x − ${fmt(x2)}) = 0\n\n`;
    } else if (disc === 0) {
        const x = -b / (2*a);
        text += `Δ = 0 → *One repeated real root*\n`;
        text += `x = −b / 2a = ${fmt(-b)} / ${fmt(2*a)} = *${fmt(x)}*\n\n`;
        text += `*Step 4 — Factored form*\n`;
        text += `${fmt(a)}(x − ${fmt(x)})² = 0\n\n`;
    } else {
        const re = -b / (2*a), im = Math.sqrt(-disc) / (2*a);
        text += `Δ < 0 → *Two complex roots (no real solution)*\n`;
        text += `x₁ = ${fmt(re)} + ${fmt(im)}i\n`;
        text += `x₂ = ${fmt(re)} − ${fmt(im)}i\n\n`;
    }

    text += `*Step 5 — Vertex of parabola*\n`;
    text += `Vertex (h, k) = (${fmt(h)}, ${fmt(k)})\n`;
    text += `Parabola opens *${a > 0 ? 'upward ↑' : 'downward ↓'}*`;
    return text;
}

function solveCubic(expr, original) {
    // Extract coefficients for ax³ + bx² + cx + d = 0
    let a3=0, a2=0, a1=0, a0=0, m;
    const e = expr.replace(/\^3/g,'³').replace(/\^2/g,'²').replace(/([0-9])x/g,'$1*x');

    const c3Re = /([+-]?\d*\.?\d*)\*?x³/g;
    while ((m = c3Re.exec(e)) !== null) {
        const k = m[1]; a3 += (k===''||k==='+') ? 1 : k==='-' ? -1 : parseFloat(k);
    }
    const c2Re = /([+-]?\d*\.?\d*)\*?x²/g;
    while ((m = c2Re.exec(e)) !== null) {
        const k = m[1]; a2 += (k===''||k==='+') ? 1 : k==='-' ? -1 : parseFloat(k);
    }
    const c1Re = /([+-]?\d*\.?\d*)\*?x(?![²³])/g;
    while ((m = c1Re.exec(e)) !== null) {
        const k = m[1]; a1 += (k===''||k==='+') ? 1 : k==='-' ? -1 : parseFloat(k);
    }
    let rest = e.replace(/[+-]?\d*\.?\d*\*?x[³²]?/g,'').replace(/[()]/g,'');
    try { a0 = rest ? parseFloat(Function(`"use strict";return(${rest})`)()) : 0; } catch { a0 = 0; }

    const f  = x => a3*x**3 + a2*x**2 + a1*x + a0;
    const df = x => 3*a3*x**2 + 2*a2*x + a1;

    // Newton-Raphson with many starting points to find up to 3 roots
    const found = new Map();
    const starts = [-1000,-500,-100,-50,-20,-10,-5,-2,-1,-0.5,0,0.5,1,2,5,10,20,50,100,500,1000];
    for (const x0 of starts) {
        let x = x0;
        for (let i = 0; i < 2000; i++) {
            const fx = f(x), fpx = df(x);
            if (Math.abs(fpx) < 1e-15) break;
            const nx = x - fx/fpx;
            if (!isFinite(nx)) break;
            if (Math.abs(nx - x) < 1e-12) { x = nx; break; }
            x = nx;
        }
        if (isFinite(x) && Math.abs(f(x)) < 1e-6) {
            const key = Math.round(x * 1e7);
            if (!found.has(key)) found.set(key, x);
        }
    }

    const roots = [...found.values()].sort((a,b)=>a-b);

    let text =
        `🧮 *Cubic Equation*\n\n📝 \`${original}\`\n` +
        `━━━━━━━━━━━━━━━━━━━━━\n` +
        `*Coefficients*\n` +
        `a = ${fmt(a3)},  b = ${fmt(a2)},  c = ${fmt(a1)},  d = ${fmt(a0)}\n\n`;

    if (roots.length === 0) {
        text += `❌ No real roots found`;
    } else {
        text += `*Real Root${roots.length > 1 ? 's' : ''}*\n`;
        roots.forEach((r, i) => {
            text += `x${roots.length > 1 ? ['₁','₂','₃'][i] : ''} = *${fmt(r)}*\n`;
        });
        text += `\n*Verification*\n`;
        roots.forEach((r, i) => {
            text += `f(${fmt(r)}) ≈ ${fmt(f(r))}\n`;
        });
    }
    return text;
}

// ── System of 2 linear equations ─────────────────────────────────────────────
function solveSystem(eq1raw, eq2raw, original) {
    // Parse each equation: ax + by = c
    function parse2Var(eq) {
        eq = eq.toLowerCase().replace(/\s+/g,'').replace(/²/g,'^2');
        const [lhs, rhs] = eq.split('=');
        const c = parseFloat(rhs) || 0;
        let a=0, b=0, m;
        const e = lhs.replace(/([0-9])x/g,'$1*x').replace(/([0-9])y/g,'$1*y');
        const xRe = /([+-]?\d*\.?\d*)\*?x/g;
        while ((m = xRe.exec(e)) !== null) {
            const k = m[1]; a += (k===''||k==='+') ? 1 : k==='-' ? -1 : parseFloat(k);
        }
        const yRe = /([+-]?\d*\.?\d*)\*?y/g;
        while ((m = yRe.exec(e)) !== null) {
            const k = m[1]; b += (k===''||k==='+') ? 1 : k==='-' ? -1 : parseFloat(k);
        }
        return { a, b, c };
    }

    const e1 = parse2Var(eq1raw);
    const e2 = parse2Var(eq2raw);
    // Cramer's rule
    const D  = e1.a*e2.b - e2.a*e1.b;
    if (Math.abs(D) < 1e-12) {
        return (
            `🧮 *System of Equations*\n\n` +
            `📝 \`${eq1raw}\`\n📝 \`${eq2raw}\`\n` +
            `━━━━━━━━━━━━━━━━━━━━━\n` +
            `❌ No unique solution (equations are parallel or identical)`
        );
    }
    const x = (e1.c*e2.b - e2.c*e1.b) / D;
    const y = (e1.a*e2.c - e2.a*e1.c) / D;

    return (
        `🧮 *System of Linear Equations*\n\n` +
        `📝 Eq 1: \`${eq1raw}\`\n` +
        `📝 Eq 2: \`${eq2raw}\`\n` +
        `━━━━━━━━━━━━━━━━━━━━━\n` +
        `*Cramer\'s Rule*\n` +
        `D  = (${fmt(e1.a)})(${fmt(e2.b)}) − (${fmt(e2.a)})(${fmt(e1.b)}) = *${fmt(D)}*\n` +
        `Dx = (${fmt(e1.c)})(${fmt(e2.b)}) − (${fmt(e2.c)})(${fmt(e1.b)}) = *${fmt(e1.c*e2.b - e2.c*e1.b)}*\n` +
        `Dy = (${fmt(e1.a)})(${fmt(e2.c)}) − (${fmt(e2.a)})(${fmt(e1.c)}) = *${fmt(e1.a*e2.c - e2.a*e1.c)}*\n\n` +
        `✅ *x = ${fmt(x)},  y = ${fmt(y)}*`
    );
}

// ── Help text ─────────────────────────────────────────────────────────────────
const HELP = `🧮 *Advanced Calculator*

*Arithmetic & Science*
\`.calc 5 + 3 * (2^4)\`
\`.calc sqrt(144) + cbrt(27)\`
\`.calc 5! + C(8,3)\`

*Trigonometry* _(degrees by default)_
\`.calc sin(30)\`  \`.calc cos(60)\`
\`.calc tan(45)\`  \`.calc asin(0.5)\`
_Radians: use_ \`sinr(PI/6)\`

*Logarithms*
\`.calc log(1000)\`  \`ln(E)\`  \`log2(64)\`

*Statistics*
\`.calc mean 10,20,30,40,50\`
\`.calc std 4,8,15,16,23,42\`
\`.calc median 3,1,4,1,5\`

*Equations (with steps)*
\`.calc 3x + 9 = 0\`
\`.calc x^2 + 5x + 6 = 0\`
\`.calc x^3 - 6x^2 + 11x - 6 = 0\`

*System of equations*
\`.calc 2x+y=7, x-y=1\`

*Number theory*
\`.calc gcd 12,18\`  \`.calc lcm 4,6\`
\`.calc prime 17\`  \`.calc factor 360\`

*Percentage*
\`.calc 15% of 200\`
\`.calc 200 + 15%\``;

// ── Module export ─────────────────────────────────────────────────────────────
module.exports = {
    name: 'calc',
    aliases: ['calculate', 'math', 'solve'],
    category: 'utility',
    description: 'Full mathematics calculator — all types of maths with steps',
    usage: '.calc <expression | equation>',

    async execute(sock, msg, args, extra) {
        try {
            if (!args.length) return extra.reply(HELP);

            const input = args.join(' ').trim();
            const result = route(input);
            await extra.reply(result);

        } catch (err) {
            console.error('[calc] error:', err);
            await extra.reply(`❌ ${err.message}`);
        }
    }
};
