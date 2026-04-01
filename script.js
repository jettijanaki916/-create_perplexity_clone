// Initialize Lucide icons
document.addEventListener('DOMContentLoaded', () => {
    // === 1. INITIALIZATION & CONFIG ===
    lucide.createIcons();

    marked.setOptions({
        highlight: function(code, lang) {
            if (lang && hljs.getLanguage(lang)) {
                return hljs.highlight(code, { language: lang }).value;
            }
            return hljs.highlightAuto(code).value;
        },
        breaks: true,
        gfm: true
    });

    // DOM Elements
    const searchInput = document.getElementById('searchInput');
    const submitBtn = document.querySelector('.submit-btn');
    const suggestionsBox = document.getElementById('suggestionsBox');
    const chatHistory = document.getElementById('chatHistory');
    const attachBtn = document.getElementById('attachBtn');
    const fileUpload = document.getElementById('fileUpload');
    const modeToggle = document.getElementById('modeToggle');
    const modeDropdown = document.getElementById('modeDropdown');
    const currentModeText = document.getElementById('currentModeText');
    const activeSource = document.getElementById('activeSource');
    const sourceName = document.getElementById('sourceName');
    const removeSource = document.getElementById('removeSource');

    let currentMode = 'all';
    let isUploading = false;
    let chatLog = []; // [{role: 'user'|'model', text: '...'}]

    // === 2. EVENT LISTENERS ===

    // Mode Selection Logic
    modeToggle.addEventListener('click', (e) => {
        e.stopPropagation();
        modeDropdown.classList.toggle('show');
    });

    document.addEventListener('click', () => {
        modeDropdown.classList.remove('show');
    });

    modeDropdown.querySelectorAll('button').forEach(btn => {
        btn.addEventListener('click', () => {
            currentMode = btn.dataset.mode;
            currentModeText.textContent = btn.textContent;
            modeDropdown.querySelectorAll('button').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            modeDropdown.classList.remove('show');
        });
    });

    // Textarea Auto-resize
    searchInput.addEventListener('input', () => {
        searchInput.style.height = 'auto';
        searchInput.style.height = (searchInput.scrollHeight) + 'px';
    });

    // Submit on Enter (Shift+Enter for newline)
    searchInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            submitQuery();
        }
    });

    // Suggestions Logic
    document.querySelectorAll('.suggestion-item, .action-btn').forEach(item => {
        item.addEventListener('click', () => {
            searchInput.value = item.textContent.trim();
            searchInput.dispatchEvent(new Event('input'));
            searchInput.focus();
        });
    });

    // File Upload Logic
    attachBtn.addEventListener('click', () => fileUpload.click());

    fileUpload.addEventListener('change', async (e) => {
        const file = e.target.files[0];
        if (!file || isUploading) return;
        
        if (file.type !== 'application/pdf') {
            alert('Please select a PDF file.');
            return;
        }

        isUploading = true;
        attachBtn.style.opacity = '0.5';
        
        const formData = new FormData();
        formData.append('file', file);

        try {
            const response = await fetch('/api/upload', {
                method: 'POST',
                body: formData
            });
            const data = await response.json();

            if (response.ok) {
                sourceName.textContent = file.name;
                activeSource.style.display = 'flex';
                // Trigger animation
                activeSource.style.animation = 'fadeInUp 0.3s ease-out';
            } else {
                alert(`Upload failed: ${data.error}`);
            }
        } catch (error) {
            console.error("Upload error:", error);
            alert("Could not connect to server.");
        } finally {
            isUploading = false;
            attachBtn.style.opacity = '1';
            fileUpload.value = '';
        }
    });

    removeSource.addEventListener('click', () => {
        activeSource.style.display = 'none';
        // Note: Currently backend keeps context until next upload. 
        // We could add a 'clear' endpoint if needed.
    });

    // === 3. CORE CHAT LOGIC ===

    async function submitQuery() {
        const query = searchInput.value.trim();
        if (!query || isUploading) return;

        // UI state: Locked
        startChatMode();
        appendMessage('user', query);
        searchInput.value = '';
        searchInput.style.height = 'auto';
        searchInput.disabled = true;
        submitBtn.disabled = true;

        const loader = appendLoader();
        
        try {
            const response = await fetch('/api/chat', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ 
                    prompt: query,
                    mode: currentMode 
                })
            });

            if (!response.ok) throw new Error("Server error");

            loader.remove();
            const messageContainer = appendMessage('model', '');
            let fullContent = "";

            const reader = response.body.getReader();
            const decoder = new TextDecoder();
            
            while (true) {
                const { value, done } = await reader.read();
                if (done) break;
                
                const chunk = decoder.decode(value);
                const lines = chunk.split('\n');
                
                for (const line of lines) {
                    if (line.startsWith('data: ')) {
                        const dataContent = line.slice(6).trim();
                        if (dataContent === '[DONE]') break;
                        
                        try {
                            const parsed = JSON.parse(dataContent);
                            if (parsed.text) {
                                fullContent += parsed.text;
                                messageContainer.innerHTML = marked.parse(fullContent);
                                // Highlight any new code blocks
                                messageContainer.querySelectorAll('pre code').forEach((block) => {
                                    if (!block.dataset.highlighted) {
                                        hljs.highlightElement(block);
                                        block.dataset.highlighted = "true";
                                    }
                                });
                                smoothScroll();
                            }
                        } catch (e) {}
                    }
                }
            }
            // Update chat log and save
            chatLog.push({ role: 'model', text: fullContent });
            saveHistory();

        } catch (error) {
            loader?.remove();
            appendMessage('model', `**Error:** ${error.message}`);
        } finally {
            searchInput.disabled = false;
            submitBtn.disabled = false;
            searchInput.focus();
        }
    }

    function startChatMode() {
        if(suggestionsBox) suggestionsBox.style.display = 'none';
        chatHistory.style.display = 'flex';
        document.querySelector('.logo-container').style.display = 'none';
        document.querySelector('.container').style.gap = '20px';
    }

    function appendMessage(role, text) {
        const messageDiv = document.createElement('div');
        messageDiv.className = `chat-message ${role}`;
        
        const senderHtml = role === 'user' 
            ? 'You' 
            : '<i data-lucide="sparkles" class="small-icon"></i> Perplexity Clone';
        
        messageDiv.innerHTML = `
            <div class="message-sender">${senderHtml}</div>
            <div class="message-text">${marked.parse(text)}</div>
        `;
        
        chatHistory.appendChild(messageDiv);
        lucide.createIcons();
        
        if (role === 'user') {
            chatLog.push({ role: 'user', text });
            saveHistory();
        }

        smoothScroll();
        return messageDiv.querySelector('.message-text');
    }

    function appendLoader() {
        const loaderDiv = document.createElement('div');
        loaderDiv.className = 'chat-message model loader-msg';
        loaderDiv.innerHTML = `
            <div class="message-sender"><i data-lucide="sparkles"></i> Perplexity Clone</div>
            <div class="message-text">
                <style>
                    .dot-flashing { position: relative; width: 6px; height: 6px; border-radius: 5px; background-color: var(--text-secondary); color: var(--text-secondary); animation: dot-flashing 1s infinite linear alternate; animation-delay: 0.5s; }
                    .dot-flashing::before, .dot-flashing::after { content: ""; display: inline-block; position: absolute; top: 0; width: 6px; height: 6px; border-radius: 5px; background-color: var(--text-secondary); color: var(--text-secondary); animation: dot-flashing 1s infinite linear alternate; }
                    .dot-flashing::before { left: -12px; animation-delay: 0s; }
                    .dot-flashing::after { left: 12px; animation-delay: 1s; }
                    @keyframes dot-flashing { 0% { background-color: var(--text-secondary); } 50%, 100% { background-color: rgba(140, 140, 140, 0.2); } }
                </style>
                <div style="padding: 10px 12px;"><div class="dot-flashing"></div></div>
            </div>
        `;
        chatHistory.appendChild(loaderDiv);
        lucide.createIcons();
        smoothScroll();
        return loaderDiv;
    }

    function smoothScroll() {
        window.scrollTo({
            top: document.body.scrollHeight,
            behavior: 'smooth'
        });
    }

    // === 4. PERSISTENCE ===

    function saveHistory() {
        localStorage.setItem('perplexity_history', JSON.stringify(chatLog));
    }

    function loadHistory() {
        const saved = localStorage.getItem('perplexity_history');
        if (saved) {
            chatLog = JSON.parse(saved);
            if (chatLog.length > 0) {
                startChatMode();
                chatLog.forEach(msg => {
                    const messageDiv = document.createElement('div');
                    messageDiv.className = `chat-message ${msg.role}`;
                    const senderHtml = msg.role === 'user' 
                        ? 'You' 
                        : '<i data-lucide="sparkles" class="small-icon"></i> Perplexity Clone';
                    
                    messageDiv.innerHTML = `
                        <div class="message-sender">${senderHtml}</div>
                        <div class="message-text">${marked.parse(msg.text)}</div>
                    `;
                    chatHistory.appendChild(messageDiv);
                });
                lucide.createIcons();
                // Highlight code blocks in history
                document.querySelectorAll('pre code').forEach(block => hljs.highlightElement(block));
                smoothScroll();
            }
        }
    }

    // Load history on init
    loadHistory();
});
