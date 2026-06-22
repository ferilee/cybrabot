
        const skillList = document.getElementById('skillList');
        const mobileSkillList = document.getElementById('mobileSkillList');
        const reachStatus = document.getElementById('reachStatus');
        const mobileReachStatus = document.getElementById('mobileReachStatus');
        const messages = document.getElementById('messages');
        const form = document.getElementById('chatForm');
        const input = document.getElementById('messageInput');
        const sendButton = document.getElementById('sendButton');
        const activeSkillTitle = document.getElementById('activeSkillTitle');
        const activeSkillDescription = document.getElementById('activeSkillDescription');
        const modelStatus = document.getElementById('modelStatus');
        const quotaLabel = document.getElementById('quotaLabel');
        const quotaBar = document.getElementById('quotaBar');
        const quotaReset = document.getElementById('quotaReset');
        const mobileQuotaLabel = document.getElementById('mobileQuotaLabel');
        const mobileQuotaBar = document.getElementById('mobileQuotaBar');
        const mobileQuotaReset = document.getElementById('mobileQuotaReset');
        const welcome = document.getElementById('welcome');
        const introButton = document.getElementById('introButton');
        const clearButton = document.getElementById('clearButton');
        const sidebar = document.getElementById('sidebar');
        const mobileMenu = document.getElementById('mobileMenu');
        const mobileSkillSheetBackdrop = document.getElementById('mobileSkillSheetBackdrop');
        const mobileSkillSheetClose = document.getElementById('mobileSkillSheetClose');
        const introModalBackdrop = document.getElementById('introModalBackdrop');
        const introModalClose = document.getElementById('introModalClose');
        const state = {
          skills: [],
          selectedSkillId: '',
          history: loadStoredHistory(),
        };
        const userAvatarUrl = "";
        const userAvatarInitial = "";
        const introTimerKey = "";
        const introAutoShownKey = "";
        let introTimerId = 0;
        let introAutoCloseId = 0;

        function formatResetTime(value) {
          if (!value) return '-';
          try {
            return new Intl.DateTimeFormat('id-ID', {
              day: '2-digit',
              month: 'short',
              year: 'numeric',
              hour: '2-digit',
              minute: '2-digit',
            }).format(new Date(value));
          } catch {
            return String(value);
          }
        }

        function formatResetCountdown(value) {
          if (!value) return '-';
          const diff = new Date(value).getTime() - Date.now();
          if (!Number.isFinite(diff) || diff <= 0) return 'kurang dari 1m';
          const totalMinutes = Math.max(1, Math.floor(diff / 60000));
          const days = Math.floor(totalMinutes / 1440);
          const hours = Math.floor((totalMinutes % 1440) / 60);
          const minutes = totalMinutes % 60;
          const parts = [];
          if (days > 0) parts.push(days + 'h');
          if (hours > 0 || days > 0) parts.push(hours + 'j');
          parts.push(minutes + 'm');
          return parts.join(' ');
        }

        function applyQuota(quota) {
          if (!quota) return;
          const remaining = Number(quota.remaining || 0);
          const limit = Number(quota.limit || 0);
          const percentLeft = Math.max(0, Math.min(100, limit ? Math.round((remaining / limit) * 100) : 0));
          const width = Math.max(0, Math.min(100, limit ? (remaining / limit) * 100 : 0)) + '%';
          const background = remaining > 0
            ? 'linear-gradient(90deg,#22d3ee,#34d399)'
            : 'linear-gradient(90deg,#f59e0b,#ef4444)';
          const countdown = formatResetCountdown(quota.resetsAt);
          const resetTime = formatResetTime(quota.resetsAt);
          const resetText = quota.resetsAt
            ? 'resets ' + countdown + ' • ' + resetTime
            : 'reset belum tersedia';
          if (quotaLabel) quotaLabel.textContent = percentLeft + '% left';
          if (quotaBar) {
            quotaBar.style.width = width;
            quotaBar.style.background = background;
          }
          if (quotaReset) quotaReset.textContent = resetText;
          if (mobileQuotaLabel) mobileQuotaLabel.textContent = percentLeft + '% left';
          if (mobileQuotaBar) {
            mobileQuotaBar.style.width = width;
            mobileQuotaBar.style.background = background;
          }
          if (mobileQuotaReset) mobileQuotaReset.textContent = resetText;
          sendButton.disabled = remaining <= 0;
          input.disabled = remaining <= 0;
          input.placeholder = remaining <= 0
            ? 'Kuota habis. Tunggu reset otomatis.'
            : 'Tulis sesuatu untuk Cybra...';
        }

        function loadStoredHistory() {
          try {
            const value = JSON.parse(sessionStorage.getItem('cybra-web-history') || '[]');
            return Array.isArray(value) ? value.slice(-12) : [];
          } catch {
            return [];
          }
        }

        function persistHistory() {
          sessionStorage.setItem('cybra-web-history', JSON.stringify(state.history.slice(-12)));
        }

        function escapeHtml(value) {
          return String(value)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
        }

        function renderRichContent(text) {
          const source = String(text || '');
          const markdown = window.marked;
          const purifier = window.DOMPurify;

          if (!markdown || !purifier) {
            return '<p>' + escapeHtml(source) + '</p>';
          }

          let normalized = source.replaceAll(
            String.fromCharCode(13) + String.fromCharCode(10),
            String.fromCharCode(10),
          );

          // Pastikan ada baris kosong sebelum tabel agar marked bisa mendeteksi tabel
          normalized = normalized.replace(/([^\n])\n(\|[^\n]+\|)\n(\|[-: |]+\|)/g, '$1\n\n$2\n$3');

          // Lindungi blok LaTeX dari markdown parsing dan DOMPurify
          const mathBlocks = [];
          normalized = normalized.replace(/\$\$([\s\S]*?)\$\$/g, (m, p) => {
            mathBlocks.push(p);
            return '%%%MATH_BLOCK_' + (mathBlocks.length - 1) + '%%%';
          });
          normalized = normalized.replace(/\$([^\n]+?)\$/g, (m, p) => {
            mathBlocks.push(p);
            return '%%%MATH_INLINE_' + (mathBlocks.length - 1) + '%%%';
          });
          normalized = normalized.replace(/\\\[([\s\S]*?)\\\]/g, (m, p) => {
            mathBlocks.push(p);
            return '%%%MATH_BLOCK_' + (mathBlocks.length - 1) + '%%%';
          });
          normalized = normalized.replace(/\\\(([\s\S]*?)\\\)/g, (m, p) => {
            mathBlocks.push(p);
            return '%%%MATH_INLINE_' + (mathBlocks.length - 1) + '%%%';
          });

          markdown.setOptions({
            gfm: true,
            breaks: true,
            headerIds: false,
            mangle: false,
          });

          const parsed = markdown.parse(normalized);
          let sanitized = purifier.sanitize(parsed, {
            USE_PROFILES: { html: true },
          });

          // Kembalikan blok LaTeX setelah DOMPurify selesai, dengan escape < dan > 
          // agar KaTeX tidak gagal parsing
          sanitized = sanitized.replace(/%%%MATH_BLOCK_(\d+)%%%/g, (m, i) => {
            return '$$' + mathBlocks[i].replace(/</g, '&lt;').replace(/>/g, '&gt;') + '$$';
          });
          sanitized = sanitized.replace(/%%%MATH_INLINE_(\d+)%%%/g, (m, i) => {
            return '$' + mathBlocks[i].replace(/</g, '&lt;').replace(/>/g, '&gt;') + '$';
          });

          return String(sanitized || '');
        }

        function renderMath(container) {
          if (!container || typeof window.renderMathInElement !== 'function') {
            return;
          }

          window.renderMathInElement(container, {
            delimiters: [
              { left: '$$', right: '$$', display: true },
              { left: '\\\\[', right: '\\\\]', display: true },
              { left: '$', right: '$', display: false },
              { left: '\\\\(', right: '\\\\)', display: false },
            ],
            throwOnError: false,
            strict: 'ignore',
          });
        }

        function renderMetaTags(meta = {}) {
          const tags = [];
          if (meta.skillTitle) tags.push('<span class="message-tag">skill: ' + escapeHtml(meta.skillTitle) + '</span>');
          if (meta.intent) tags.push('<span class="message-tag">intent: ' + escapeHtml(meta.intent) + '</span>');
          if (meta.model) tags.push('<span class="message-tag">model: ' + escapeHtml(meta.model) + '</span>');
          if (meta.fallback) tags.push('<span class="message-tag warn">fallback</span>');
          if (meta.route && !meta.skillTitle) tags.push('<span class="message-tag">' + escapeHtml(meta.route) + '</span>');
          return tags.length ? '<div class="message-tags">' + tags.join('') + '</div>' : '';
        }

        function renderMessageActions(meta = {}) {
          if (!meta.exportFile || !meta.exportFile.downloadUrl) {
            return '';
          }

          const label = meta.exportFile.format
            ? 'Unduh ' + String(meta.exportFile.format).toUpperCase()
            : 'Unduh File';

          return '<div class="message-actions">' +
            '<a class="download-link" href="' + escapeHtml(meta.exportFile.downloadUrl) + '" download="' + escapeHtml(meta.exportFile.fileName || '') + '">' +
            '<span>⬇</span><span>' + escapeHtml(label) + '</span>' +
            '</a></div>';
        }

        function parseTimerSeconds(text) {
          const match = String(text || '').match(/\[(\d{2}):(\d{2})\]/);
          if (!match) return null;
          const minutes = Number(match[1] || 0);
          const seconds = Number(match[2] || 0);
          if (!Number.isFinite(minutes) || !Number.isFinite(seconds)) return null;
          return (minutes * 60) + seconds;
        }

        function formatSecondsLabel(totalSeconds) {
          const seconds = Math.max(0, Math.floor(totalSeconds));
          const minutesPart = String(Math.floor(seconds / 60)).padStart(2, '0');
          const secondsPart = String(seconds % 60).padStart(2, '0');
          return '[' + minutesPart + ':' + secondsPart + ']';
        }

        function ensureMessageActions(bubble) {
          return bubble.querySelector('.message-actions') || (() => {
            const node = document.createElement('div');
            node.className = 'message-actions';
            bubble.appendChild(node);
            return node;
          })();
        }

        function appendMessageAction(actionsWrap, options) {
          if (!actionsWrap || !options || !options.action) return;
          if (actionsWrap.querySelector('[data-action="' + options.action + '"]')) return;

          const button = document.createElement('button');
          button.type = 'button';
          button.className = 'message-action-button';
          button.dataset.action = options.action;
          button.textContent = options.label;
          button.addEventListener('click', async () => {
            button.disabled = true;
            await submitMessage(options.message, { forceSkillId: 'grill-me' });
          });
          actionsWrap.appendChild(button);
        }

        function enhanceGrillMessage(bubble, meta = {}) {
          if (!bubble || meta.skillId !== 'grill-me') return;
          const contentEl = bubble.querySelector('.message-content');
          if (!contentEl) return;

          const originalContent = String(meta.originalContent || '');
          const timerSeconds = parseTimerSeconds(originalContent);
          if (timerSeconds !== null) {
            contentEl.innerHTML = contentEl.innerHTML.replace(/\[(\d{2}):(\d{2})\]/, '<span class="grill-timer" data-seconds="' + String(timerSeconds) + '">[$1:$2]</span>');
            const timerEl = contentEl.querySelector('.grill-timer');
            if (timerEl) {
              let remaining = timerSeconds;
              timerEl.textContent = formatSecondsLabel(remaining);
              const intervalId = window.setInterval(() => {
                remaining -= 1;
                timerEl.textContent = formatSecondsLabel(remaining);
                if (remaining <= 0) {
                  timerEl.classList.add('expired');
                  window.clearInterval(intervalId);
                }
              }, 1000);
            }
          }

          const wantsContinueButton =
            /lanjut ke soal berikutnya/i.test(originalContent) &&
            !/sesi selesai|latihan selesai|semua soal selesai/i.test(originalContent);

          const wantsEndButton =
            !/sesi latihan diakhiri|sesi latihan sudah selesai|kalau mau, kirim topik baru/i.test(originalContent);

          const actionsWrap = wantsContinueButton || wantsEndButton
            ? ensureMessageActions(bubble)
            : null;

          if (wantsContinueButton) {
            appendMessageAction(actionsWrap, {
              action: 'grill-continue',
              label: 'Lanjut ke Soal Berikutnya',
              message: 'lanjut',
            });
          }

          if (wantsEndButton) {
            appendMessageAction(actionsWrap, {
              action: 'grill-end',
              label: 'Akhiri Sesi',
              message: 'akhiri sesi',
            });
          }
        }

        function addMessage(role, content, meta = {}) {
          if (welcome) welcome.hidden = true;
          document.getElementById('typingMessage')?.remove();
          const row = document.createElement('article');
          row.className = 'message-row ' + role;
          const avatar = document.createElement('div');
          if (role === 'user' && userAvatarUrl) {
            avatar.className = 'avatar';
            avatar.innerHTML = '<img src="' + escapeHtml(userAvatarUrl) + '" alt="User avatar" style="width:100%;height:100%;border-radius:50%;object-fit:cover;border:3px solid rgba(255,255,255,0.78);box-shadow:0 10px 26px rgba(5,19,31,0.35);background:rgba(255,255,255,0.08);">';
          } else {
            avatar.className = 'avatar';
            avatar.textContent = role === 'user' ? userAvatarInitial : 'C';
          }
          const bubble = document.createElement('div');
          bubble.className = 'bubble';
          const time = new Intl.DateTimeFormat('id-ID', {
            hour: '2-digit',
            minute: '2-digit',
          }).format(new Date());
          const label = role === 'user' ? 'Kamu' : 'Cybra';
          const detail = meta.skillTitle || meta.route || '';
          const contentHtml = renderRichContent(content);
          bubble.innerHTML =
            '<div class="message-meta"><strong>' + label + '</strong><span>' + escapeHtml(time) + '</span>' +
            (detail ? '<span>· ' + escapeHtml(detail) + '</span>' : '') +
            '</div><div class="message-content">' + contentHtml + '</div>' +
            renderMessageActions(meta) + renderMetaTags(meta);
          row.append(avatar, bubble);
          messages.appendChild(row);
          enhanceGrillMessage(bubble, {
            skillId: meta.skillId,
            originalContent: content,
          });
          renderMath(bubble.querySelector('.message-content'));
          messages.scrollTo({ top: messages.scrollHeight, behavior: 'smooth' });
        }

        function updateHeaderMeta(meta = {}) {
          const chips = [];
          chips.push('<span class="meta-chip">skill: ' + escapeHtml(meta.skillTitle || 'auto') + '</span>');
          if (meta.intent) chips.push('<span class="meta-chip">intent: ' + escapeHtml(meta.intent) + '</span>');
          if (meta.intentModel) chips.push('<span class="meta-chip">intent-model: ' + escapeHtml(meta.intentModel) + '</span>');
          if (meta.model) chips.push('<span class="meta-chip">model: ' + escapeHtml(meta.model) + '</span>');
          if (meta.fallback) chips.push('<span class="meta-chip alert">fallback active</span>');
          modelStatus.innerHTML = chips.join('');
        }

        function showTyping() {
          const el = document.createElement('article');
          el.id = 'typingMessage';
          el.className = 'message-row assistant typing';
          el.innerHTML =
            '<div class="avatar">C</div><div class="bubble">' +
            '<div class="message-meta"><strong>Cybra</strong><span>sedang meracik jawaban</span></div>' +
            '<div class="typing-dots"><span></span><span></span><span></span></div></div>';
          messages.appendChild(el);
          messages.scrollTop = messages.scrollHeight;
        }

        function closeSidebar() {
          sidebar?.classList.remove('open');
        }

        function openMobileSkillSheet() {
          if (!mobileSkillSheetBackdrop) return;
          mobileSkillSheetBackdrop.classList.add('open');
          mobileSkillSheetBackdrop.setAttribute('aria-hidden', 'false');
        }

        function closeMobileSkillSheet() {
          if (!mobileSkillSheetBackdrop) return;
          mobileSkillSheetBackdrop.classList.remove('open');
          mobileSkillSheetBackdrop.setAttribute('aria-hidden', 'true');
        }

        function hideIntroModal() {
          if (!introModalBackdrop) return;
          if (introAutoCloseId) {
            window.clearTimeout(introAutoCloseId);
            introAutoCloseId = 0;
          }
          introModalBackdrop.classList.remove('open');
          introModalBackdrop.setAttribute('aria-hidden', 'true');
        }

        function showIntroModal(mode = 'manual') {
          if (!introModalBackdrop) return;
          if (introAutoCloseId) {
            window.clearTimeout(introAutoCloseId);
            introAutoCloseId = 0;
          }
          introModalBackdrop.classList.add('open');
          introModalBackdrop.setAttribute('aria-hidden', 'false');
          if (mode === 'auto') {
            sessionStorage.setItem(introAutoShownKey, '1');
            introAutoCloseId = window.setTimeout(() => {
              hideIntroModal();
            }, 10000);
          }
        }

        function scheduleIntroModal() {
          if (!introModalBackdrop) return;
          if (sessionStorage.getItem(introAutoShownKey) === '1') return;
          const stored = Number(sessionStorage.getItem(introTimerKey) || '');
          const startedAt = Number.isFinite(stored) && stored > 0 ? stored : Date.now();
          sessionStorage.setItem(introTimerKey, String(startedAt));
          const remainingMs = Math.max(0, 180000 - (Date.now() - startedAt));
          if (remainingMs === 0) {
            showIntroModal('auto');
            return;
          }
          if (introTimerId) {
            window.clearTimeout(introTimerId);
          }
          introTimerId = window.setTimeout(() => showIntroModal('auto'), remainingMs);
        }

        function selectSkill(skillId) {
          state.selectedSkillId = skillId;
          const selected = state.skills.find((skill) => skill.id === skillId);
          activeSkillTitle.textContent = selected ? selected.title : 'Auto Skill';
          activeSkillDescription.textContent = selected ? selected.description : 'Cybra memilih kemampuan yang paling cocok.';
          for (const list of [skillList, mobileSkillList]) {
            if (!list) continue;
            for (const button of list.querySelectorAll('button')) {
              button.classList.toggle('active', button.dataset.skillId === skillId);
            }
          }
          closeSidebar();
          closeMobileSkillSheet();
        }

        function renderSkillButtons(target) {
          if (!target) return;
          target.innerHTML = '';

          const autoButton = document.createElement('button');
          autoButton.className = 'skill-button' + (state.selectedSkillId ? '' : ' active');
          autoButton.dataset.skillId = '';
          autoButton.innerHTML = '<strong>✦ Auto Skill <span class="skill-badge">auto</span></strong><span>Biarkan Cybra memilih modul yang sesuai</span>';
          autoButton.addEventListener('click', () => selectSkill(''));
          target.appendChild(autoButton);

          for (const skill of state.skills) {
            const button = document.createElement('button');
            button.className = 'skill-button' + (state.selectedSkillId === skill.id ? ' active' : '');
            button.dataset.skillId = skill.id;
            const badge = skill.modelHint ? '<span class="skill-badge">' + escapeHtml(skill.modelHint) + '</span>' : '';
            button.innerHTML = '<strong>' + escapeHtml(skill.title) + badge + '</strong><span>' + escapeHtml(skill.description || '') + '</span>';
            button.addEventListener('click', () => selectSkill(skill.id));
            target.appendChild(button);
          }
        }

        function setSupportStatus(target, text) {
          if (!target) return;
          target.innerHTML = '<span class="reach-chip" title="' + escapeHtml(text) + '">' +
            '<i class="reach-dot missing"></i>' + escapeHtml(text) + '</span>';
        }

        async function readJsonResponse(response) {
          const text = await response.text();
          try {
            return text ? JSON.parse(text) : {};
          } catch {
            return { error: text || response.statusText || 'Response tidak valid.' };
          }
        }

        async function loadSkills() {
          try {
            const response = await fetch('/api/chat/skills');
            const data = await readJsonResponse(response);
            if (!response.ok) throw new Error(data.error || 'Gagal memuat skill.');
            state.skills = Array.isArray(data.skills) ? data.skills : [];
          } catch {
            state.skills = [];
          } finally {
            renderSkillButtons(skillList);
            renderSkillButtons(mobileSkillList);
          }
        }

        async function loadAgentReachStatus() {
          try {
            const response = await fetch('/api/agent-reach/status');
            const data = await readJsonResponse(response);
            if (!response.ok) throw new Error(data.error || 'Gagal memuat Agent Reach.');
            const channels = Array.isArray(data.channels) ? data.channels : [];
            const html = channels.map((channel) => {
              const dotClass = channel.available ? 'reach-dot' : 'reach-dot missing';
              return '<span class="reach-chip" title="' + escapeHtml(channel.detail) + '">' +
                '<i class="' + dotClass + '"></i>' + escapeHtml(channel.title) + '</span>';
            }).join('');
            if (reachStatus) reachStatus.innerHTML = html;
            if (mobileReachStatus) mobileReachStatus.innerHTML = html;
          } catch {
            setSupportStatus(reachStatus, 'Agent Reach belum tersedia');
            setSupportStatus(mobileReachStatus, 'Agent Reach belum tersedia');
          }
        }

        async function loadMe() {
          const response = await fetch('/api/me');
          const data = await readJsonResponse(response);
          if (!response.ok) throw new Error(data.error || 'Gagal memuat profil.');
          applyQuota(data.quota);
        }

        async function submitMessage(rawMessage, options = {}) {
          const message = String(rawMessage || '').trim();
          if (!message) return;

          input.value = '';
          input.style.height = 'auto';
          sendButton.disabled = true;
          addMessage('user', message);
          state.history.push({ role: 'user', content: message });
          persistHistory();
          showTyping();

          try {
            const response = await fetch('/api/chat', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                message,
                skillId: options.forceSkillId || state.selectedSkillId || undefined,
                history: state.history.slice(-12),
              }),
            });
            const data = await readJsonResponse(response);
            if (!response.ok) {
              if (data.quota) applyQuota(data.quota);
              throw new Error(data.error || 'Request failed');
            }
            applyQuota(data.quota);
            addMessage('assistant', data.reply || '', {
              skillId: data.skill?.id,
              skillTitle: data.skill?.title,
              route: data.route,
              intent: data.intent,
              intentModel: data.intentModel,
              model: data.model,
              fallback: data.fallback,
              exportFile: data.exportFile,
            });
            updateHeaderMeta({
              skillTitle: data.skill?.title,
              intent: data.intent,
              intentModel: data.intentModel,
              model: data.model,
              fallback: data.fallback,
            });
            state.history.push({ role: 'assistant', content: data.reply || '' });
            persistHistory();
          } catch (error) {
            const text = error instanceof Error ? error.message : 'Terjadi kesalahan.';
            addMessage('assistant', text, { route: 'error' });
          } finally {
            sendButton.disabled = Boolean(input.disabled);
            input.focus();
          }
        }

        form.addEventListener('submit', async (event) => {
          event.preventDefault();
          await submitMessage(input.value);
        });

        input.addEventListener('keydown', (event) => {
          if (event.key === 'Enter' && !event.shiftKey) {
            event.preventDefault();
            form.requestSubmit();
          }
        });

        input.addEventListener('input', () => {
          input.style.height = 'auto';
          input.style.height = Math.min(input.scrollHeight, 140) + 'px';
        });

        clearButton.addEventListener('click', () => {
          state.history = [];
          persistHistory();
          messages.querySelectorAll('.message-row').forEach((item) => item.remove());
          if (welcome) welcome.hidden = false;
          updateHeaderMeta({});
          input.focus();
        });

        mobileMenu?.addEventListener('click', () => {
          openMobileSkillSheet();
        });
        mobileSkillSheetClose?.addEventListener('click', closeMobileSkillSheet);
        mobileSkillSheetBackdrop?.addEventListener('click', (event) => {
          if (event.target === mobileSkillSheetBackdrop) {
            closeMobileSkillSheet();
          }
        });
        introButton?.addEventListener('click', () => showIntroModal('manual'));
        introModalClose?.addEventListener('click', hideIntroModal);
        introModalBackdrop?.addEventListener('click', (event) => {
          if (event.target === introModalBackdrop) {
            hideIntroModal();
          }
        });
        document.addEventListener('keydown', (event) => {
          if (event.key === 'Escape' && mobileSkillSheetBackdrop?.classList.contains('open')) {
            closeMobileSkillSheet();
          }
          if (event.key === 'Escape' && introModalBackdrop?.classList.contains('open')) {
            hideIntroModal();
          }
        });
        scheduleIntroModal();

        document.querySelectorAll('.suggestion').forEach((button) => {
          button.addEventListener('click', () => submitMessage(button.textContent));
        });

        renderSkillButtons(skillList);
        renderSkillButtons(mobileSkillList);
        setSupportStatus(reachStatus, 'Memuat Agent Reach...');
        setSupportStatus(mobileReachStatus, 'Memuat Agent Reach...');

        Promise.allSettled([loadSkills(), loadAgentReachStatus(), loadMe()]).then(() => {
          for (const item of state.history) {
            addMessage(item.role, item.content, { route: 'riwayat' });
          }
          updateHeaderMeta({});
          input.focus();
        });
      