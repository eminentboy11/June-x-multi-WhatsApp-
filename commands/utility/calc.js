/**
 * Advanced Calculator — arithmetic + quadratic equation solver with full steps
 */

module.exports = {
    name: 'calc',
    aliases: ['calculate', 'math', 'solve'],
    category: 'utility',
    description: 'Calculate expressions or solve quadratic equations step by step',
    usage: '.calc <expression | equation>',

    async execute(sock, msg, args, extra) {
        try {
            if (!args.length) {
                return extra.reply(
                    '🧮 *Calculator*\n\n' +
                    '*Arithmetic:*\n' +
                    '`.calc 5 + 3 * (2 - 1)`\n\n' +
                    '*Quadratic equation (= 0):*\n' +
                    '`.calc x^2 + 5x + 6 = 0`\n' +
                    '`.calc 2x^2 - 3x - 5 = 0`\n\n' +
                    '*Linear equation:*\n' +
                    '`.calc 3x + 9 = 0`'
                );
            }

            const input = args.join(' ').trim();

            // ── Route: equation vs plain arithmetic ───────────────────────────
            if (/[a-zA-Z]/.test(input)) {
                return extra.reply(solveEquation(input));
            }

            // ── Plain arithmetic ───────────────────────────────────────────────
            const safeExpr = input.replace(/[^0-9+\-*/().\s%^]/g, '');
            if (!safeExpr) return extra.reply('❌ Invalid expression.');

            // Replace ^ with ** for exponentiation
            const jsExpr = safeExpr.replace(/\^/g, '**');
            const result = Function('"use strict"; return (' + jsExpr + ')')();

            if (!isFinite(result)) return extra.reply('❌ Result is undefined (division by zero?)');

            await extra.reply(
                `🧮 *Calculator*\n\n` +
                `📝 *Expression:* \`${input}\`\n` +
                `✅ *Result:* \`${round(result)}\``
            );

        } catch (err) {
            await extra.reply(`❌ Error: ${err.message}`);
        }
    }
};

// ── Equation solver ───────────────────────────────────────────────────────────
function solveEquation(input) {
    // Normalise: replace ² with ^2, x² → x^2
    let eq = input
        .replace(/²/g, '^2')
        .replace(/\s+/g, '')
        .toLowerCase();

    // Move everything to the left side if there's an "= 0" or "= <number>"
    if (eq.includes('=')) {
        const [lhs, rhs] = eq.split('=');
        const rhsVal = parseFloat(rhs);
        if (isNaN(rhsVal)) return '❌ Could not parse the right-hand side.';
        // Subtract rhs from lhs: effectively ax^2 + bx + (c - rhs) = 0
        eq = rhsVal === 0 ? lhs : `${lhs}-(${rhsVal})`;
    }

    // Try to extract quadratic coefficients: ax^2 + bx + c
    const { a, b, c, isQuadratic } = extractCoeffs(eq);

    if (isQuadratic) return solveQuadratic(a, b, c, input);
    if (a === 0 && b !== 0) return solveLinear(b, c, input);

    return '❌ Could not parse the equation. Try format like: `x^2 + 5x + 6 = 0`';
}

// ── Quadratic solver with steps ───────────────────────────────────────────────
function solveQuadratic(a, b, c, original) {
    const disc = b * b - 4 * a * c;
    const h    = -b / (2 * a);       // vertex x
    const k    = c - (b * b) / (4 * a); // vertex y

    let text = `🧮 *Quadratic Equation Solver*\n\n`;
    text += `📝 *Input:* \`${original}\`\n`;
    text += `━━━━━━━━━━━━━━━━━━━━━\n\n`;

    text += `*Step 1 — Standard form*\n`;
    text += `\`ax² + bx + c = 0\`\n`;
    text += `a = ${round(a)},  b = ${round(b)},  c = ${round(c)}\n\n`;

    text += `*Step 2 — Discriminant (Δ)*\n`;
    text += `\`Δ = b² - 4ac\`\n`;
    text += `\`Δ = (${round(b)})² - 4(${round(a)})(${round(c)})\`\n`;
    text += `\`Δ = ${round(b * b)} - ${round(4 * a * c)}\`\n`;
    text += `\`Δ = ${round(disc)}\`\n\n`;

    text += `*Step 3 — Roots*\n`;
    text += `\`x = (−b ± √Δ) / 2a\`\n\n`;

    if (disc > 0) {
        const sqrtDisc = Math.sqrt(disc);
        const x1 = (-b + sqrtDisc) / (2 * a);
        const x2 = (-b - sqrtDisc) / (2 * a);
        text += `Δ > 0 → *two distinct real roots*\n`;
        text += `\`x₁ = (−(${round(b)}) + √${round(disc)}) / (2 × ${round(a)})\`\n`;
        text += `\`x₁ = ${round(x1)}\`\n\n`;
        text += `\`x₂ = (−(${round(b)}) − √${round(disc)}) / (2 × ${round(a)})\`\n`;
        text += `\`x₂ = ${round(x2)}\`\n\n`;
        text += `*Step 4 — Factored form*\n`;
        text += `\`${round(a)}(x − ${round(x1)})(x − ${round(x2)}) = 0\`\n\n`;
    } else if (disc === 0) {
        const x = -b / (2 * a);
        text += `Δ = 0 → *one repeated real root*\n`;
        text += `\`x = −b / 2a = −(${round(b)}) / (2 × ${round(a)})\`\n`;
        text += `\`x = ${round(x)}\`\n\n`;
        text += `*Step 4 — Factored form*\n`;
        text += `\`${round(a)}(x − ${round(x)})² = 0\`\n\n`;
    } else {
        const realPart = -b / (2 * a);
        const imagPart = Math.sqrt(-disc) / (2 * a);
        text += `Δ < 0 → *two complex (imaginary) roots*\n`;
        text += `\`x₁ = ${round(realPart)} + ${round(imagPart)}i\`\n`;
        text += `\`x₂ = ${round(realPart)} − ${round(imagPart)}i\`\n\n`;
    }

    text += `*Step 5 — Vertex of parabola*\n`;
    text += `\`(h, k) = (−b/2a,  c − b²/4a)\`\n`;
    text += `\`Vertex = (${round(h)}, ${round(k)})\`\n`;
    text += `Parabola opens *${a > 0 ? 'upward ↑' : 'downward ↓'}*`;

    return text;
}

// ── Linear solver with steps ─────────────────────────────────────────────────
function solveLinear(b, c, original) {
    const x = -c / b;
    let text = `🧮 *Linear Equation Solver*\n\n`;
    text += `📝 *Input:* \`${original}\`\n`;
    text += `━━━━━━━━━━━━━━━━━━━━━\n\n`;
    text += `*Step 1 — Standard form:* \`bx + c = 0\`\n`;
    text += `b = ${round(b)},  c = ${round(c)}\n\n`;
    text += `*Step 2 — Isolate x*\n`;
    text += `\`${round(b)}x = −${round(c)}\`\n`;
    text += `\`x = −${round(c)} / ${round(b)}\`\n\n`;
    text += `✅ *Answer:* \`x = ${round(x)}\``;
    return text;
}

// ── Coefficient extractor ─────────────────────────────────────────────────────
function extractCoeffs(expr) {
    // Normalise: insert * between number and x, handle signs
    let e = expr
        .replace(/\^2/g, '²')           // keep ² as marker
        .replace(/([0-9])x/g, '$1*x')   // 5x → 5*x
        .replace(/([0-9])²/g, '$1²');

    // Match: ax², bx, c  — scan term by term
    let a = 0, b = 0, c = 0, isQuadratic = false;

    // ax^2 / ax²
    const quadRe = /([+-]?\d*\.?\d*)\*?x²/g;
    let m;
    while ((m = quadRe.exec(e)) !== null) {
        const coeff = m[1];
        a += coeff === '' || coeff === '+' ? 1 : coeff === '-' ? -1 : parseFloat(coeff);
        isQuadratic = true;
    }

    // bx (not followed by ²)
    const linRe = /([+-]?\d*\.?\d*)\*?x(?!²)/g;
    while ((m = linRe.exec(e)) !== null) {
        const coeff = m[1];
        b += coeff === '' || coeff === '+' ? 1 : coeff === '-' ? -1 : parseFloat(coeff);
    }

    // constant terms — remove x terms then parse what's left
    let rest = e
        .replace(/[+-]?\d*\.?\d*\*?x²/g, '')
        .replace(/[+-]?\d*\.?\d*\*?x(?!²)/g, '')
        .replace(/[()]/g, '');

    try {
        // rest may be like "-6+2" etc — evaluate safely
        c = rest ? Function('"use strict"; return (' + rest + ')')() : 0;
        if (!isFinite(c)) c = 0;
    } catch { c = 0; }

    return { a, b, c, isQuadratic };
}

function round(n, dp = 6) {
    return parseFloat(n.toFixed(dp));
}
