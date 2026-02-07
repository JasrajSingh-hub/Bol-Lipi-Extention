// BOL-LIPI Content Script (AI Form Assistant)

let widgetContainer = null;
let shadowRoot = null;
let recognition = null;
let isListening = false;
let currentLang = "en-IN";
let apiKey = localStorage.getItem("bol_lipi_api_key") || "";
let conversationHistory = [];
let formFields = [];
let currentFieldIndex = -1;

// 1. Initialize Widget
function createWidget() {
  if (widgetContainer) return;

  widgetContainer = document.createElement("div");
  widgetContainer.id = "bol-lipi-widget-container";
  Object.assign(widgetContainer.style, {
    position: "fixed", bottom: "20px", right: "20px", zIndex: "999999", display: "none"
  });

  shadowRoot = widgetContainer.attachShadow({ mode: "open" });
  
  const style = document.createElement("style");
  style.textContent = `
    :host { font-family: 'Segoe UI', sans-serif; }
    .widget-box {
      width: 320px; height: 500px;
      background: #1a1a2e; color: white;
      border-radius: 16px;
      box-shadow: 0 10px 30px rgba(0,0,0,0.5);
      display: flex; flex-direction: column;
      border: 1px solid rgba(255,255,255,0.1);
    }
    .header {
      background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
      padding: 15px; display: flex; justify-content: space-between; align-items: center;
    }
    .title { font-weight: 700; font-size: 18px; }
    .icon-btn { background: none; border: none; color: white; cursor: pointer; font-size: 18px; padding: 5px; }
    
    .view { display: none; flex-direction: column; flex-grow: 1; padding: 15px; overflow: hidden; }
    .view.active { display: flex; }

    /* Chat View */
    .chat-area {
      flex-grow: 1; overflow-y: auto; display: flex; flex-direction: column; gap: 10px; margin-bottom: 15px;
      padding-right: 5px;
    }
    .msg { padding: 8px 12px; border-radius: 10px; font-size: 13px; max-width: 80%; word-wrap: break-word; }
    .msg.ai { background: rgba(255,255,255,0.1); align-self: flex-start; border-bottom-left-radius: 2px; }
    .msg.user { background: #764ba2; align-self: flex-end; border-bottom-right-radius: 2px; }
    
    .input-area { display: flex; align-items: center; gap: 10px; background: rgba(0,0,0,0.2); padding: 10px; border-radius: 12px; }
    .mic-btn {
      width: 40px; height: 40px; border-radius: 50%; background: #764ba2;
      display: flex; align-items: center; justify-content: center;
      cursor: pointer; border: none; color: white; font-size: 20px;
    }
    .mic-btn.listening { animation: pulse 1.5s infinite; background: #ef4444; }
    
    /* Settings View */
    .settings-form { display: flex; flex-direction: column; gap: 15px; }
    label { font-size: 13px; color: #a0a0a0; }
    input[type="text"] {
      background: rgba(255,255,255,0.05); border: 1px solid rgba(255,255,255,0.1);
      color: white; padding: 10px; border-radius: 8px; width: 100%; box-sizing: border-box;
    }
    .save-btn {
      background: #764ba2; color: white; border: none; padding: 10px; border-radius: 8px;
      cursor: pointer; font-weight: bold; margin-top: 10px;
    }

    @keyframes pulse { 0% { opacity: 1; } 50% { opacity: 0.5; } 100% { opacity: 1; } }
    
    ::-webkit-scrollbar { width: 4px; }
    ::-webkit-scrollbar-thumb { background: rgba(255,255,255,0.2); border-radius: 2px; }
  `;

  const wrapper = document.createElement("div");
  wrapper.className = "widget-box";
  wrapper.innerHTML = `
    <div class="header">
      <span class="title">Bol Lipi AI</span>
      <div>
        <button class="icon-btn" id="settings-btn">⚙️</button>
        <button class="icon-btn" id="close-btn">×</button>
      </div>
    </div>

    <!-- MAIN CHAT VIEW -->
    <div class="view active" id="view-chat">
      <div class="chat-area" id="chat-history">
        <div class="msg ai">Hello! I can help you fill this form. Click the mic to start.</div>
      </div>
      <div class="input-area">
        <button class="mic-btn" id="mic-btn">🎤</button>
        <div style="font-size: 12px; color: #aaa; flex-grow: 1; text-align: center;" id="status-text">Tap to Speak</div>
      </div>
    </div>

    <!-- SETTINGS VIEW -->
    <div class="view" id="view-settings">
      <h3>Settings</h3>
      <div class="settings-form">
        <div>
          <label>Gemini API Key</label>
          <input type="text" id="api-key-input" placeholder="Paste your API key here">
        </div>
        <button class="save-btn" id="save-key-btn">Save Key</button>
        <button class="save-btn" style="background:transparent; border:1px solid #555;" id="cancel-settings">Back</button>
      </div>
    </div>
  `;

  shadowRoot.appendChild(style);
  shadowRoot.appendChild(wrapper);
  document.body.appendChild(widgetContainer);

  // Bind UI Events
  shadowRoot.getElementById("close-btn").onclick = () => toggleWidget(false);
  shadowRoot.getElementById("settings-btn").onclick = () => switchView("settings");
  shadowRoot.getElementById("cancel-settings").onclick = () => switchView("chat");
  shadowRoot.getElementById("mic-btn").onclick = toggleListening;
  
  shadowRoot.getElementById("save-key-btn").onclick = () => {
    const key = shadowRoot.getElementById("api-key-input").value.trim();
    if (key) {
      apiKey = key;
      localStorage.setItem("bol_lipi_api_key", key);
      addMessage("ai", "API Key saved! We are ready to go.");
      switchView("chat");
    }
  };

  // Pre-fill key if exists
  if (apiKey) shadowRoot.getElementById("api-key-input").value = apiKey;
}

function toggleWidget(show) {
  console.log("Bol-Lipi: Toggling widget", show);
  if (!widgetContainer) createWidget();
  widgetContainer.style.display = show ? "block" : "none";
  if (show && formFields.length === 0) scanForm();
}

function switchView(viewName) {
  shadowRoot.getElementById("view-chat").classList.remove("active");
  shadowRoot.getElementById("view-settings").classList.remove("active");
  shadowRoot.getElementById(`view-${viewName}`).classList.add("active");
}

function addMessage(role, text) {
  const chat = shadowRoot.getElementById("chat-history");
  const msg = document.createElement("div");
  msg.className = `msg ${role}`;
  msg.innerText = text;
  chat.appendChild(msg);
  chat.scrollTop = chat.scrollHeight;

  if (role === "ai" && text) speak(text);
}

// 2. Form Scanning Logic
function scanForm() {
  const inputs = document.querySelectorAll("input:not([type='hidden']):not([type='submit']), textarea, select");
  formFields = [];
  
  inputs.forEach((el, index) => {
    // Try to find a label
    let label = "";
    if (el.labels && el.labels.length > 0) label = el.labels[0].innerText;
    else if (el.placeholder) label = el.placeholder;
    else if (el.name) label = el.name;
    else if (el.id) label = el.id;

    // Check if visible
    const rect = el.getBoundingClientRect();
    if (rect.width > 0 && rect.height > 0) {
      formFields.push({
        index: index,
        element: el,
        label: label.trim(),
        value: el.value,
        type: el.type
      });
    }
  });

  console.log("Scanned Fields:", formFields);
  if (formFields.length > 0) {
    addMessage("ai", `I see ${formFields.length} fields. Shall we start filling them?`);
  } else {
    addMessage("ai", "I couldn't find any visible form fields on this page.");
  }
}

// 3. Speech & AI Logic
function toggleListening() {
  if (isListening) {
    recognition.stop();
    return;
  }

  if (!recognition) {
    recognition = new webkitSpeechRecognition();
    recognition.continuous = false;
    recognition.interimResults = false;
    recognition.lang = currentLang;

    recognition.onstart = () => {
      isListening = true;
      shadowRoot.getElementById("mic-btn").classList.add("listening");
      shadowRoot.getElementById("status-text").innerText = "Listening...";
    };

    recognition.onend = () => {
      isListening = false;
      shadowRoot.getElementById("mic-btn").classList.remove("listening");
      shadowRoot.getElementById("status-text").innerText = "Tap to Speak";
    };

    recognition.onresult = (event) => {
      const text = event.results[0][0].transcript;
      addMessage("user", text);
      handleUserResponse(text);
    };
  }
  recognition.start();
}

async function handleUserResponse(userText) {
  if (!apiKey) {
    addMessage("ai", "Please set your Gemini API Key in settings first.");
    return;
  }

  // Identify the target field (simplistic for now: First empty one)
  const targetField = formFields.find(f => !f.element.value);
  
  if (!targetField) {
    addMessage("ai", "It looks like the form is complete!");
    return;
  }

  addMessage("ai", "Thinking...");

  try {
    const aiResponse = await callGemini(userText, targetField);
    
    // Parse response
    // Expecting JSON: { "value": "extracted value", "question": "next question", "filled": boolean }
    // But for robustness, let's ask for raw text first or structured json
    
    if (aiResponse.value) {
      targetField.element.value = aiResponse.value;
      // Highlight update
      targetField.element.style.border = "2px solid #764ba2";
      addMessage("ai", `Filled ${targetField.label} with "${aiResponse.value}".`);
    }

    if (aiResponse.next_question) {
       addMessage("ai", aiResponse.next_question);
    } else {
       // Move to next
       const next = formFields.find(f => !f.element.value && f !== targetField);
       if (next) addMessage("ai", `Okay, what about ${next.label}?`);
       else addMessage("ai", "Form completed.");
    }

  } catch (e) {
    console.error(e);
    addMessage("ai", "Sorry, I had trouble connecting to the AI.");
  }
}

async function callGemini(userSpeech, fieldInfo) {
  const prompt = `
    You are a form filling assistant.
    Current Field to fill: "${fieldInfo.label}"
    User just said: "${userSpeech}"
    
    Task:
    1. Extract the value for the field from the user's speech.
    2. If the user didn't provide a value, ask a clarifying question.
    
    Return pure JSON:
    {
      "value": "extracted value or null",
      "next_question": "optional question if value is missing"
    }
  `;

  const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-pro:generateContent?key=${apiKey}`;
  
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }]
    })
  });

  const data = await response.json();
  const rawText = data.candidates[0].content.parts[0].text;
  
  // Clean markdown code blocks if any
  const jsonStr = rawText.replace(/```json/g, "").replace(/```/g, "").trim();
  return JSON.parse(jsonStr);
}

function speak(text) {
  const utterance = new SpeechSynthesisUtterance(text);
  speechSynthesis.speak(utterance);
}

// Global Listener
chrome.runtime.onMessage.addListener((msg) => {
  console.log("Bol-Lipi Content: Received message", msg);
  if (msg.type === "TOGGLE_WIDGET") {
    const isVisible = widgetContainer && widgetContainer.style.display !== "none";
    toggleWidget(!isVisible);
  }
});
