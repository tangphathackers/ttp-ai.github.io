// script.js (Phiên bản v4.6.1 - Final Stable Build - Diagnostic Fix)

import { translations as langEN } from './lang-en.js';
import { translations as langVI } from './lang-vi.js';
import { initParticles } from './particles.js';
import { exec } from './ttp-ai.js';

// --- Global State & DOM Elements ---
let currentLang = {};
let maxCpuFreq = 0;
let toastTimer;
let interactionCounter = 0;
let surpriseActive = false;

// DOM Elements
let outputDiv, deviceInfoDiv, keyInfoDiv, aiGreetingDiv, batteryInfoDiv, tempInfoDiv, cpuCoreGraphDiv, mainTitle, digitalRainContainer, runDiagnosticsBtn, diagnosticActionsDiv, aiInitialMessage, aiSuggestionContent, commandLogDiv;

// --- Hàm chính được gọi khi DOM đã sẵn sàng ---
document.addEventListener('DOMContentLoaded', main);

async function main() {
    // Gán giá trị cho các biến DOM
    outputDiv = document.getElementById("output");
    deviceInfoDiv = document.getElementById("deviceInfo");
    keyInfoDiv = document.getElementById("keyInfo");
    aiGreetingDiv = document.getElementById("aiGreeting");
    batteryInfoDiv = document.getElementById("batteryInfo");
    tempInfoDiv = document.getElementById("tempInfo");
    cpuCoreGraphDiv = document.getElementById("cpuCoreGraph");
    mainTitle = document.getElementById("mainTitle");
    digitalRainContainer = document.getElementById("digitalRainContainer");
    runDiagnosticsBtn = document.getElementById('runDiagnosticsBtn');
    diagnosticActionsDiv = document.getElementById('diagnostic-actions');
    aiInitialMessage = document.getElementById('aiInitialMessage');
    aiSuggestionContent = document.getElementById('aiSuggestionContent');
    commandLogDiv = document.getElementById('commandLog');

    initParticles('particleCanvas', 'rgba(173, 216, 230, 0.5)', 'rgba(106, 173, 255, 0.15)');
    
    await initializeCoreData();

    await Promise.all([
        updateKeyInfo(),
        updateDeviceInfo(),
        updateLiveStats(),
        renderLog()
    ]);

    applyFeatureTiering();
    setupButtonListeners();
    setInterval(updateLiveStats, 2000);
}

function applyFeatureTiering() {
    const keyInfo = JSON.parse(localStorage.getItem("ttp_key_info") || "{}");
    const allowedFeatures = new Set(keyInfo.allowedFeatures || []);

    if (allowedFeatures.size === 0) {
        console.warn("Allowed features list not found or user is free tier. Locking VIP features.");
    }

    buttonMappings.forEach(mapping => {
        const button = document.getElementById(mapping.id);
        if (button) {
            const alias = mapping.cmd.replace('remote-alias:', '');
            if (allowedFeatures.has(alias) || allowedFeatures.has('all')) {
                button.disabled = false;
                button.removeAttribute('title');
                button.classList.remove('disabled-feature');
            } else {
                button.disabled = true;
                button.title = "Tính năng này yêu cầu Key VIP";
                button.classList.add('disabled-feature');
            }
        }
    });
}

async function initializeCoreData() {
    try {
        const localeRes = await exec('getprop persist.sys.locale');
        const langCode = (localeRes.stdout || 'en-US').trim().toLowerCase();
        applyLanguage(langCode.startsWith('vi') ? 'vi' : 'en');
    } catch (e) {
        console.warn(`Could not get system locale. Using default 'en'.`);
        applyLanguage('en');
    }

    try {
        const maxFreqRes = await exec("cat /sys/devices/system/cpu/cpu0/cpufreq/cpuinfo_max_freq");
        maxCpuFreq = parseInt(maxFreqRes.stdout.trim(), 10);
        if (!maxCpuFreq || isNaN(maxCpuFreq)) {
             maxCpuFreq = 3000000;
             console.warn("Parsed max CPU frequency is invalid, using default.");
        }
    } catch (e) {
        console.error(`Could not get max CPU frequency. Using default.`, e.message);
        maxCpuFreq = 3000000;
    }
}

function applyLanguage(langCode) {
    const allLangs = { en: langEN, vi: langVI };
    currentLang = allLangs[langCode] || allLangs.en;
    document.documentElement.lang = langCode;
    document.querySelectorAll('[data-lang-key]').forEach(el => {
        const key = el.dataset.langKey;
        if (currentLang[key]) {
            const target = el.querySelector('span') || el;
            target.innerHTML = currentLang[key];
        }
    });
    if (aiGreetingDiv) {
        const greeting = currentLang.aiGreeting || [];
        aiGreetingDiv.innerText = greeting.length > 0 ? greeting[Math.floor(Math.random() * greeting.length)] : "Welcome";
    }
}

function updateKeyInfo() {
    if (!keyInfoDiv || !currentLang.keyLabel) return;
    try {
        const keyInfoData = JSON.parse(localStorage.getItem("ttp_key_info") || "{}");
        if (keyInfoData.name && keyInfoData.expiry) {
            keyInfoDiv.innerHTML = `🔑 ${currentLang.keyLabel}: <b>${keyInfoData.name}</b><br>📅 ${currentLang.expiryLabel}: <b>${keyInfoData.expiry}</b>`;
            keyInfoDiv.style.display = 'block';
        } else {
            keyInfoDiv.style.display = 'none';
        }
    } catch (error) { console.error("Error updating Key Info:", error); }
}

async function updateDeviceInfo() {
    if (!deviceInfoDiv || !currentLang.loadingDeviceInfo) return;
    deviceInfoDiv.innerHTML = `<span>${currentLang.loadingDeviceInfo}</span>`;
    try {
        const get = async (prop) => (await exec(`getprop ${prop}`)).stdout.trim() || "?";
        const getCpuInfo = async () => {
            try {
                const cpuInfoRes = await exec("cat /proc/cpuinfo | grep -m 1 -E 'Hardware|model name'");
                return cpuInfoRes.stdout ? cpuInfoRes.stdout.split(':')[1].trim() : await get("ro.board.platform");
            } catch (e) { return await get("ro.soc.model"); }
        };
        const [glesInfoRes, socModel] = await Promise.all([
             exec("dumpsys SurfaceFlinger | grep 'GLES:'"),
             getCpuInfo()
        ]);
        const glesInfo = glesInfoRes.stdout.split(',')[1]?.trim() || "?";
        const info = {
            [currentLang.deviceNameLabel]: await get("ro.product.marketname"),
            [currentLang.modelLabel]: await get("ro.product.model"),
            [currentLang.androidLabel]: await get("ro.build.version.release"),
            [currentLang.socLabel]: socModel,
            [currentLang.gpuLabel]: glesInfo,
        };
        let html = "";
        for (const [label, value] of Object.entries(info)) {
            html += `<b>${label}:</b> ${value === '?' ? 'N/A' : value}<br/>`;
        }
        deviceInfoDiv.innerHTML = html;
    } catch (error) { console.error("Error updating Device Info:", error); }
}

async function updateLiveStats() {
    let results;
    try {
        results = await Promise.all([
            exec("dumpsys battery | grep -E 'level|temperature'"),
            exec("cat /sys/devices/system/cpu/cpu*/cpufreq/scaling_cur_freq")
        ]);
    } catch (error) {
        console.error("A critical command failed in updateLiveStats:", error);
        return;
    }
    
    const [batteryRes, cpuFreqRes] = results;

    try {
        if (batteryInfoDiv && tempInfoDiv && batteryRes && batteryRes.stdout) {
            const levelMatch = batteryRes.stdout.match(/level: (\d+)/);
            const tempMatch = batteryRes.stdout.match(/temperature: (\d+)/);
            const battery = levelMatch ? parseInt(levelMatch[1], 10) : 0;
            const temp = tempMatch ? parseInt(tempMatch[1], 10) / 10 : 0;
            batteryInfoDiv.innerHTML = `<div class="label">${currentLang.batteryLevel || 'Battery'}</div><div class="value">${battery}%</div>`;
            tempInfoDiv.innerHTML = `<div class="label">${currentLang.batteryTemp || 'Temp'}</div><div class="value">${temp.toFixed(1)}°C</div>`;
        }
    } catch (e) { console.error("Error parsing battery/temp info:", e); }

    try {
        if (cpuCoreGraphDiv && cpuFreqRes && cpuFreqRes.stdout) {
            const coreFreqs = cpuFreqRes.stdout.trim().split('\n').map(f => {
                const freq = parseInt(f.trim(), 10);
                return isNaN(freq) ? 0 : freq;
            });
            updateCpuGraph(coreFreqs);
        } else {
            if (cpuCoreGraphDiv) cpuCoreGraphDiv.innerHTML = `<span style="color: var(--danger-color); font-size: 0.8em;">CPU Freq N/A</span>`;
        }
    } catch(e) { console.error("Error parsing or rendering CPU graph:", e); }
}

function updateCpuGraph(coreFrequencies) {
    if (!cpuCoreGraphDiv || !currentLang.cpuCore || !maxCpuFreq) return;
    
    let graphHTML = ''; 
    coreFrequencies.forEach((freqKhz, index) => {
        const percentage = (freqKhz / maxCpuFreq) * 100;
        const mhz = freqKhz / 1000;
        graphHTML += `
            <div class="core-bar-container">
                <div class="core-label">${currentLang.cpuCore} ${index}</div>
                <div class="core-bar-wrapper">
                    <div class="core-bar" style="width: ${Math.min(100, Math.max(0, percentage))}%;"></div>
                </div>
                <div class="core-freq">${mhz.toFixed(0)} MHz</div>
            </div>`;
    });
    cpuCoreGraphDiv.innerHTML = graphHTML;
}

function addLogEntry(command, status) {
    const timestamp = new Date().toLocaleTimeString();
    const cleanCommand = command.replace(/^(remote-alias:|script:)/, '');
    let logs = JSON.parse(sessionStorage.getItem('commandLog') || '[]');
    logs.unshift({ timestamp, command: cleanCommand, status });
    if (logs.length > 20) logs.pop();
    sessionStorage.setItem('commandLog', JSON.stringify(logs));
    renderLog();
}

function renderLog() {
    if (!commandLogDiv || !currentLang.noCommandsYet) return;
    let logs = JSON.parse(sessionStorage.getItem('commandLog') || '[]');
    if (logs.length === 0) {
        commandLogDiv.innerHTML = `<p data-lang-key="noCommandsYet">${currentLang.noCommandsYet}</p>`;
        return;
    }
    commandLogDiv.innerHTML = logs.map(log => `
        <div class="log-entry">
            <span class="timestamp">[${log.timestamp}]</span>
            <span class="status status-${log.status}">[${log.status.toUpperCase()}]</span>
            <span class="cmd-name">${log.command}</span>
        </div>
    `).join('');
}

// --- HÀM RUN_DIAGNOSTICS ĐÃ SỬA LỖI ---
async function runDiagnostics() {
    // 1. Chuyển sang trạng thái "Đang phân tích" một cách an toàn
    aiInitialMessage.style.display = 'none';
    aiSuggestionContent.style.display = 'block';
    aiSuggestionContent.innerHTML = currentLang.diagnosticRunning || "Analyzing...";
    diagnosticActionsDiv.innerHTML = `<button class="button-hex" disabled><span>...</span></button>`; // Thay thế bằng trạng thái loading

    try {
        // 2. Lấy dữ liệu
        const batteryRes = await exec("dumpsys battery | grep -E 'level|temperature'");
        const levelMatch = batteryRes.stdout.match(/level: (\d+)/);
        const tempMatch = batteryRes.stdout.match(/temperature: (\d+)/);
        const battery = levelMatch ? parseInt(levelMatch[1], 10) : 100;
        const temp = tempMatch ? parseInt(tempMatch[1], 10) / 10 : 30;
        
        const suggestion = getSuggestionOnDemand(battery, temp);
        
        // 3. Hiển thị kết quả
        aiSuggestionContent.innerHTML = `<p>${suggestion.message}</p>`;
        
        // 4. Tạo các nút hành động mới
        let actionButtonsHTML = '';
        if (suggestion.command) {
            actionButtonsHTML += `
                <button id="ai-action-btn" class="button-hex primary small">
                    <span>${suggestion.buttonText}</span>
                </button>`;
        }
        // Luôn thêm nút chẩn đoán lại
        actionButtonsHTML += `
            <button id="rerunDiagnosticsBtn" class="button-hex secondary small">
                <span>${currentLang.diagnosticRerun || "RERUN"}</span>
            </button>`;

        // 5. Thay thế toàn bộ khu vực hành động bằng các nút mới
        diagnosticActionsDiv.innerHTML = actionButtonsHTML;

        // 6. Gán sự kiện click cho các nút vừa tạo
        const aiActionButton = document.getElementById('ai-action-btn');
        if (aiActionButton) {
            aiActionButton.onclick = () => {
                handleButton('ai-action-btn', 2, suggestion.command);
                aiActionButton.disabled = true;
            };
        }
        document.getElementById('rerunDiagnosticsBtn').onclick = runDiagnostics;

    } catch (error) {
        aiSuggestionContent.innerHTML = `<p>${currentLang.errorDeviceInfo || 'Device Error'}: ${error.message}</p>`;
        // Trong trường hợp lỗi, chỉ hiển thị nút chẩn đoán lại
        const rerunBtnHTML = `
            <button id="rerunDiagnosticsBtn" class="button-hex secondary small">
                <span>${currentLang.diagnosticRerun || "RERUN"}</span>
            </button>`;
        diagnosticActionsDiv.innerHTML = rerunBtnHTML;
        document.getElementById('rerunDiagnosticsBtn').onclick = runDiagnostics;
    }
}


function getSuggestionOnDemand(battery, temp) {
    if (temp >= 40.0) return { message: `${currentLang.diagResultTempHigh || 'Temp High'} (${temp}°C).`, buttonText: currentLang.diagActionLag, command: "remote-alias:giamlag" };
    if (battery <= 20) return { message: `${currentLang.diagResultBatteryLow || 'Battery Low'} (${battery}%).`, buttonText: currentLang.diagActionConserve, command: "remote-alias:muot" };
    if (temp >= 38.0) return { message: `${currentLang.diagResultTempWarm || 'Temp Warm'} (${temp}°C).`, buttonText: currentLang.diagActionLag, command: "remote-alias:giamlag" };
    if (battery <= 36) return { message: `${currentLang.diagResultBatteryLow || 'Battery Low'} (${battery}%).`, buttonText: currentLang.diagActionConserve, command: "remote-alias:muot" };
    return { message: `${currentLang.diagResultAllGood || 'All Good'} (Temp: ${temp}°C, Bat: ${battery}%).`, command: null };
}

async function handleButton(id, delaySec, cmd) {
    interactionCounter++;
    if (interactionCounter === 5 && !surpriseActive) {
        triggerConsciousnessScan(id, delaySec, cmd);
        interactionCounter = 0;
        return;
    }
    const btn = document.getElementById(id);
    if (btn) btn.disabled = true;

    render({}, 'pending');
    await new Promise(r => setTimeout(r, delaySec * 1000));

    try {
        const result = await exec(cmd);
        const status = result.stderr ? 'error' : 'success';
        render(result, status);
        addLogEntry(cmd, status);
        if (status === 'success') {
            setTimeout(updateLiveStats, 1000);
        }
    } catch (error) {
        console.warn(`Command failed:`, error);
        addLogEntry(cmd, 'error');
        const errorMessage = error.stderr || error.message || "An unknown error occurred.";
        render({ stderr: errorMessage }, 'error');
    } finally {
        if (btn && id !== 'ai-action-btn' && id !== 'rerunDiagnosticsBtn') {
            btn.disabled = false;
        }
    }
}

const buttonMappings = [
  { id: "ttp-giamlag",    cmd: "remote-alias:giamlag" },
  { id: "ttp-boost",      cmd: "remote-alias:boost" },
  { id: "ttp-muot",       cmd: "remote-alias:muot" },
  { id: "ttp-ram",        cmd: "remote-alias:ram" },
  { id: "ttp-mediumtouch",cmd: "remote-alias:mediumtouch" },
  { id: "ttp-hightouch",  cmd: "remote-alias:hightouch" },
  { id: "ttp-lowdpi",     cmd: "remote-alias:lowdpi" },
  { id: "ttp-highdpi",    cmd: "remote-alias:highdpi" },
  { id: "ttp-highdpi_2",  cmd: "remote-alias:highdpi_2" },
  { id: "ttp-cuongche",   cmd: "remote-alias:cuongche" },
  { id: "ttp-fps90",      cmd: "remote-alias:fps90" },
  { id: "ttp-fps120",     cmd: "remote-alias:fps120" },
  { id: "ttp-gamenhetam", cmd: "remote-alias:gamenhetam" },
  { id: "ttp-gameboc",    cmd: "remote-alias:gameboc" },
  { id: "ttp-rtouch",     cmd: "remote-alias:rtouch" },
  { id: "ttp-rdpi",       cmd: "remote-alias:rdpi" },
  { id: "ttp-rram",       cmd: "remote-alias:rram" },
  { id: "ttp-resetall",   cmd: "remote-alias:resetall" },
  { id: "ttp-reboot",     cmd: "remote-alias:reboot" }
];

function setupButtonListeners() {
    // Gán sự kiện cho nút chẩn đoán ban đầu
    const initialRunBtn = document.getElementById('runDiagnosticsBtn');
    if (initialRunBtn) {
        initialRunBtn.onclick = runDiagnostics;
    }

    // Gán sự kiện cho các nút chức năng khác
    for (const { id, cmd } of buttonMappings) {
        const button = document.getElementById(id);
        if (button) {
          button.onclick = () => handleButton(id, 2, cmd);
        }
    }
}

function render(res, type = 'default') {
    if (!currentLang.toast_pending_label || !outputDiv) return;
    let message, label, toastClass;
    switch(type) {
        case 'pending': label = currentLang.toast_pending_label; message = currentLang.toast_pending; toastClass = 'toast--pending'; break;
        case 'success': label = currentLang.toast_success; message = res.stdout || currentLang.toast_completed; toastClass = 'toast--success'; break;
        case 'error': label = currentLang.toast_error; message = res.stderr || "Unknown error"; toastClass = 'toast--error'; break;
        case 'special': label = res.label; message = res.message; toastClass = 'toast--special'; break;
        default: return;
    }
    outputDiv.className = 'toast';
    clearTimeout(toastTimer);
    outputDiv.innerHTML = `<b>${label}:</b> ${message}`;
    outputDiv.classList.add(toastClass);
    requestAnimationFrame(() => outputDiv.classList.add('visible'));
    toastTimer = setTimeout(() => outputDiv.classList.remove('visible'), 6000);
}

function triggerConsciousnessScan(originalId, originalDelay, originalCmd) {
    if (surpriseActive) return;
    surpriseActive = true;
    digitalRainContainer.classList.add('active');
    createDigitalRain(digitalRainContainer, 100, currentLang.rainWords);
    const originalTitleHTML = mainTitle.innerHTML;
    mainTitle.innerHTML = `<span style="color:#ff00ff; text-shadow: 0 0 10px #ff00ff;">${currentLang.neuralLinkActive}</span>`;
    render({ label: currentLang.aiConsciousnessScanTitle, message: currentLang.aiConsciousnessScanMessage }, 'special');
    setTimeout(() => {
        handleButton(originalId, originalDelay, originalCmd);
        setTimeout(() => {
            mainTitle.innerHTML = originalTitleHTML;
            surpriseActive = false;
            digitalRainContainer.classList.remove('active');
            digitalRainContainer.innerHTML = '';
        }, 4000);
    }, 2500);
}

function createDigitalRain(container, count, wordList = []) {
    if (!container) return;
    container.innerHTML = '';
    const chars = "ﾊﾐﾋｰｳｼﾅﾓﾆｻﾜﾂｵﾘｱﾎﾃﾏｹﾒｴｶｷﾑﾕﾗｾﾈｽﾀﾇﾍｦｲｸｺｿﾁﾄﾉﾌﾔﾖﾙﾚﾛﾝ01";
    for (let i = 0; i < count; i++) {
        const isWord = wordList.length > 0 && Math.random() > 0.9;
        const el = document.createElement('span');
        el.style.left = `${Math.random() * 100}vw`;
        el.style.top = `${Math.random() * -50 - 10}vh`;
        el.style.animationDuration = `${Math.random() * 3 + 3}s`;
        el.style.animationDelay = `${Math.random() * 4}s`;
        if (isWord) {
            el.className = 'rain-word';
            el.textContent = wordList[Math.floor(Math.random() * wordList.length)];
        } else {
            el.className = 'rain-char';
            el.textContent = chars[Math.floor(Math.random() * chars.length)];
            el.style.fontSize = `${Math.random() * 10 + 10}px`;
            el.style.opacity = Math.random() * 0.5 + 0.3;
        }
        container.appendChild(el);
    }
}