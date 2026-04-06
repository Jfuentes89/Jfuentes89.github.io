const fs = require('fs');

let css = fs.readFileSync('styles.css', 'utf-8');

// Variables Light
css = css.replace(/--teal-light: #7DDDD8;/g, "--teal-light: #44CDE8;");
css = css.replace(/--teal-dark: #1A7878;/g, "--teal-dark: #24D2D3;");
css = css.replace(/--crimson: #8B1A1A;/g, "--purple-light: #B47DF3;");
css = css.replace(/--salmon: #F09070;/g, "--purple-dark: #8E54E9;");

// Fondos Light
css = css.replace(/--bg-primary: #EEF8F7;/g, "--bg-primary: #F5F6FA;");
css = css.replace(/--bg-secondary: #FFFFFF;/g, "--bg-secondary: #FFFFFF;");
css = css.replace(/--bg-card: rgba\(255, 255, 255, 0.97\);/g, "--bg-card: #FFFFFF;");
css = css.replace(/--bg-card-hover: rgba\(255, 255, 255, 1\);/g, "--bg-card-hover: #F8F9FA;");
css = css.replace(/--bg-input: #F0FAF9;/g, "--bg-input: #F5F6FA;");

// Fondos Dark
css = css.replace(/--bg-primary: #0C1A1A;/g, "--bg-primary: #1B1E32;");
css = css.replace(/--bg-secondary: #0F2626;/g, "--bg-secondary: #262A3E;");
css = css.replace(/--bg-card: #132020;/g, "--bg-card: #262A3E;");
css = css.replace(/--bg-card-hover: #1A2C2C;/g, "--bg-card-hover: #2F344D;");
css = css.replace(/--bg-input: #142222;/g, "--bg-input: #1B1E32;");

// Bordes
css = css.replace(/--border: rgba\(26, 120, 120, 0.12\);/g, "--border: rgba(26, 28, 41, 0.08);");
css = css.replace(/--border-accent: rgba\(26, 120, 120, 0.40\);/g, "--border-accent: rgba(68, 205, 232, 0.30);");

// Textos (light)
css = css.replace(/--text-primary: #1C2E2E;/g, "--text-primary: #1A1C29;");
css = css.replace(/--text-secondary: #3D6060;/g, "--text-secondary: #8E93A6;");
css = css.replace(/--text-muted: #7A9A9A;/g, "--text-muted: #B3B7C6;");

// Textos (dark)
css = css.replace(/--text-primary: #E8F8F7;/g, "--text-primary: #FFFFFF;");
css = css.replace(/--text-secondary: #88BFBE;/g, "--text-secondary: #9095A9;");
css = css.replace(/--text-muted: #4A7878;/g, "--text-muted: #6B7085;");

// Acentos bases
css = css.replace(/--accent: #1A7878;/g, "--accent: #44CDE8;");
css = css.replace(/--accent-2: #0F5555;/g, "--accent-2: #8E54E9;");

// Sombras y glow specificos
css = css.replace(/rgba\(26, 120, 120, 0.18\)/g, "rgba(68, 205, 232, 0.20)");
css = css.replace(/rgba\(125, 221, 216, 0.20\)/g, "rgba(68, 205, 232, 0.20)");

// Danger (para mantenerlo diferente a los globales de color)
css = css.replace(/--danger: #8B1A1A;/g, "--danger: #E85A71;");
css = css.replace(/rgba\(139, 26, 26, /g, "rgba(232, 90, 113, ");
css = css.replace(/#8B1A1A/g, "#E85A71");

// Reemplazos genéricos de colores viejos a nuevos
// Hex #1A7878 (viejo principal teal) -> var(--accent) o #44CDE8
css = css.replace(/#1A7878/g, "#44CDE8");
// Hex #7DDDD8 (viejo secundario teal) -> var(--accent-2) o #8E54E9
css = css.replace(/#7DDDD8/g, "#8E54E9");
css = css.replace(/#0F5555/g, "#8E54E9");

// Arreglar cosas por los reemplazos directos
css = css.replace(/linear-gradient\(135deg, #8E54E9, #44CDE8\)/g, "linear-gradient(135deg, var(--accent), var(--accent-2))");
css = css.replace(/linear-gradient\(135deg, #44CDE8, #8E54E9\)/g, "linear-gradient(135deg, var(--accent), var(--accent-2))");

css = css.replace(/rgba\(26, 120, 120, /g, "rgba(68, 205, 232, ");
css = css.replace(/rgba\(125, 221, 216, /g, "rgba(142, 84, 233, ");

// The topbar currently uses #44CDE8 (was #1A7878) as background.
// The user wants it to look like the image (clean topbar with just TM in it, or basically matching the background)
// Wait, currently topbar has white text. If we change it to background: var(--bg-primary); color: var(--text-primary);
css = css.replace(/\.mobile-topbar {\s*display: flex;\s*align-items: center;\s*justify-content: space-between;\s*padding: 0 1rem;\s*height: var\(--topbar-h\);\s*background: #44CDE8;\s*border-bottom: 1px solid rgba\(255, 255, 255, 0.08\);/g, 
  ".mobile-topbar {\n  display: flex;\n  align-items: center;\n  justify-content: space-between;\n  padding: 0 1rem;\n  height: var(--topbar-h);\n  background: var(--bg-primary);\n  border-bottom: 1px solid var(--border);\n  color: var(--text-primary);");

css = css.replace(/\.mobile-topbar h2 {\s*font-family: var\(--font-title\);\s*font-size: 1.45rem;\s*letter-spacing: 3px;\s*color: #fff;/g, 
  ".mobile-topbar h2 {\n  font-family: var(--font-title);\n  font-size: 1.45rem;\n  letter-spacing: 3px;\n  color: var(--text-primary);");

css = css.replace(/\.topbar-sub {\s*font-size: \.6rem;\s*color: rgba\(255, 255, 255, 0.50\);/g, 
  ".topbar-sub {\n  font-size: .6rem;\n  color: var(--text-secondary);");

css = css.replace(/\.hamburger {\s*background: none;\s*border: none;\s*cursor: pointer;\s*color: #fff;/g, 
  ".hamburger {\n  background: none;\n  border: none;\n  cursor: pointer;\n  color: var(--text-primary);");

css = css.replace(/\.topbar-logo {\s*width: 34px;\s*height: 34px;\s*border-radius: 10px;\s*background: rgba\(255, 255, 255, 0.18\);\s*display: flex;\s*align-items: center;\s*justify-content: center;\s*font-family: var\(--font-title\);\s*font-size: 1.1rem;\s*color: #fff;/g, 
  ".topbar-logo {\n  width: 34px;\n  height: 34px;\n  border-radius: 10px;\n  background: linear-gradient(135deg, var(--accent), var(--accent-2));\n  display: flex;\n  align-items: center;\n  justify-content: center;\n  font-family: var(--font-title);\n  font-size: 1.1rem;\n  color: #fff;");

css = css.replace(/\.bottom-nav {\s*display: flex;\s*flex-direction: column;\s*position: fixed;\s*bottom: 0;\s*left: 0;\s*right: 0;\s*background: #44CDE8;\s*border-top: 1px solid rgba\(255, 255, 255, 0.10\);/g, 
  ".bottom-nav {\n  display: flex;\n  flex-direction: column;\n  position: fixed;\n  bottom: 0;\n  left: 0;\n  right: 0;\n  background: var(--bg-secondary);\n  border-top: 1px solid var(--border);");

css = css.replace(/\.bottom-nav-item {\s*flex: 1;\s*display: flex;\s*flex-direction: column;\s*align-items: center;\s*justify-content: center;\s*gap: 4px;\s*cursor: pointer;\s*transition: color \.18s;\s*color: rgba\(255, 255, 255, 0.45\);/g, 
  ".bottom-nav-item {\n  flex: 1;\n  display: flex;\n  flex-direction: column;\n  align-items: center;\n  justify-content: center;\n  gap: 4px;\n  cursor: pointer;\n  transition: color .18s;\n  color: var(--text-secondary);");

css = css.replace(/\.bottom-nav-item\.active {\s*color: #8E54E9;/g, 
  ".bottom-nav-item.active {\n  color: var(--accent);");

css = css.replace(/\.bottom-nav-item\.active::after {\s*content: '';\s*position: absolute;\s*top: 0;\s*left: 50%;\s*transform: translateX\(-50%\);\s*width: 32px;\s*height: 3px;\s*background: #8E54E9;/g, 
  ".bottom-nav-item.active::after {\n  content: '';\n  position: absolute;\n  top: 0;\n  left: 50%;\n  transform: translateX(-50%);\n  width: 32px;\n  height: 3px;\n  background: var(--accent);");

css = css.replace(/\.bottom-nav-fab span {\s*font-size: \.59rem;\s*font-weight: 700;\s*letter-spacing: \.4px;\s*text-transform: uppercase;\s*color: rgba\(255, 255, 255, 0.6\);/g, 
  ".bottom-nav-fab span {\n  font-size: .59rem;\n  font-weight: 700;\n  letter-spacing: .4px;\n  text-transform: uppercase;\n  color: var(--text-secondary);");

css = css.replace(/\.bottom-nav-fab\.active span {\s*color: #8E54E9;/g, 
  ".bottom-nav-fab.active span {\n  color: var(--accent);");

css = css.replace(/\.btn-primary {\s*background: linear-gradient\(135deg, var\(--accent\), var\(--accent-2\)\);\s*color: #fff;\s*box-shadow: 0 4px 18px rgba\(68, 205, 232, 0.40\);\s*}/g,
  ".btn-primary {\n  background: linear-gradient(135deg, var(--accent), var(--accent-2));\n  color: #fff;\n  box-shadow: 0 4px 18px var(--accent-glow);\n}");

// write back css
fs.writeFileSync('styles.css', css);

// update index.html inline styles if necessary
let html = fs.readFileSync('index.html', 'utf-8');
html = html.replace(/#1A7878/g, "var(--accent)");
html = html.replace(/#7DDDD8/g, "var(--accent-2)");
fs.writeFileSync('index.html', html);

console.log("Replaced colors successfully");
