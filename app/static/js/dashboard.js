/* ==========================================================================
   DASHBOARD DYNAMIC DATA & VISUAL EMPTY STATE MODULE (V6 - NEW MOCKUP)
   ========================================================================== */

// Global Meetings helper fallback
window.Meetings = window.Meetings || {
  openCreateModal: function () {
    window.location.href = '/meetings?action=create';
  },
  openQuickMeetingModal: function () {
    window.location.href = '/meetings?action=quick';
  }
};

const Dashboard = {
  _hasEventListener: false,
  _cachedHashes: {
    live_meeting: 'null',
    next_meeting: 'null'
  },

  _shouldUpdate(key, data) {
    const newHash = JSON.stringify(data || null);
    if (this._cachedHashes[key] === newHash) {
      return false; // Veri değişmedi, DOM yenilenmesin!
    }
    this._cachedHashes[key] = newHash;
    return true;
  },

  async init() {
    this.updateUserGreetingAndDate();
    await this.loadStats();
    this.listenToEvents();
  },

  listenToEvents() {
    if (this._hasEventListener) return;
    this._hasEventListener = true;

    window.addEventListener('meeting:changed', () => {
      console.log("🔄 [Dashboard] Canlı olay alındı, veriler kontrol ediliyor...");
      this.loadStats();
    });
  },

  showSkeletons() {
    const todayList = document.getElementById('todayMeetingsListContainer');
    if (todayList && !todayList.dataset.loaded) {
      todayList.innerHTML = `
        <div class="skeleton-card" style="border: none; padding: 0.5rem 0; background: transparent;">
          <div class="skeleton-box skeleton-text-lg" style="width: 85%; margin-bottom: 0.5rem;"></div>
          <div class="skeleton-box skeleton-text-sm" style="width: 50%;"></div>
        </div>
      `;
    }

    const upcomingList = document.getElementById('upcomingMeetingsListContainer');
    if (upcomingList && !upcomingList.dataset.loaded) {
      upcomingList.innerHTML = `
        <div class="skeleton-card" style="border: none; padding: 0.5rem 0; background: transparent;">
          <div class="skeleton-box skeleton-text-lg" style="width: 85%; margin-bottom: 0.5rem;"></div>
          <div class="skeleton-box skeleton-text-sm" style="width: 50%;"></div>
        </div>
      `;
    }
  },

  updateUserGreetingAndDate() {
    const currentUser = Auth.getUser();
    const nameEl = document.getElementById('dashUserName');
    if (nameEl && currentUser && currentUser.first_name) {
      nameEl.textContent = currentUser.first_name;
    }

    const dateEl = document.getElementById('dashCurrentDateText');
    if (dateEl) {
      dateEl.textContent = 'Bugün harika bir gün! Verimli toplantılar sizi bekliyor.';
    }
  },

  async loadStats() {
    try {
      const response = await Auth.fetchWithAuth('/api/v1/dashboard/stats');

      if (response.ok) {
        const stats = await response.json();

        if (this._shouldUpdate('metrics', {
          t: stats.today_meetings,
          u: stats.upcoming_meetings,
          c: stats.completed_meetings,
          h: stats.total_duration_hours
        })) {
          this.renderMetrics(stats);
        }

        if (this._shouldUpdate('live_meeting', stats.live_meeting)) {
          this.renderLiveMeetingCard(stats.live_meeting);
        }

        if (this._shouldUpdate('next_meeting', stats.next_meeting)) {
          this.renderNextMeetingCard(stats.next_meeting);
        }

        if (this._shouldUpdate('today_list', stats.today_list)) {
          this.renderTodayMeetingsList(stats.today_list || []);
          this.renderAgendaTimeline(stats.today_list || []);
        }

        if (this._shouldUpdate('upcoming_list', stats.upcoming_list)) {
          this.renderUpcomingMeetingsList(stats.upcoming_list || []);
        }
      }
    } catch (err) {
      console.warn("Dashboard verileri yüklenirken uyarı:", err);
    }
  },

  renderMetrics(stats) {
    const elToday = document.getElementById('statCountToday');
    const elScheduled = document.getElementById('statCountScheduled');
    const elCompleted = document.getElementById('statCountCompleted');
    const elNotes = document.getElementById('statCountNotes') || document.getElementById('statCountHours');

    if (elToday && stats.today_meetings !== undefined) elToday.textContent = stats.today_meetings;
    if (elScheduled && stats.upcoming_meetings !== undefined) elScheduled.textContent = stats.upcoming_meetings;
    if (elCompleted && stats.completed_meetings !== undefined) elCompleted.textContent = stats.completed_meetings;
    if (elNotes) {
      if (stats.total_notes !== undefined) {
        elNotes.textContent = stats.total_notes;
      } else if (stats.total_duration_hours !== undefined) {
        elNotes.textContent = `${stats.total_duration_hours} saat`;
      }
    }
  },

  renderLiveMeetingCard(liveMeeting) {
    const container = document.getElementById('cardLiveMeetingContainer');
    if (!container) return;

    let contentHtml = '';
    if (!liveMeeting) {
      contentHtml = `
        <div style="text-align: center; padding: 0.25rem; display: flex; flex-direction: column; align-items: center; justify-content: center; height: 100%;">
          <div style="width: 52px; height: 52px; border-radius: 16px; background: #e0e7ff; color: #5b5fc7; display: flex; align-items: center; justify-content: center; font-size: 1.6rem; margin-bottom: 0.65rem;">
            <i class="fas fa-video"></i>
          </div>
          <h3 style="font-size: 1.05rem; font-weight: 800; color: #0f172a; margin-bottom: 0.25rem;">Henüz aktif bir toplantınız yok</h3>
          <p style="color: #64748b; font-size: 0.8rem; max-width: 300px; margin-bottom: 0.85rem; line-height: 1.35;">Yeni bir toplantı başlatın veya planladığınız toplantıya katılın.</p>
          <div style="display: flex; gap: 0.6rem;">
            <button onclick="Meetings.openCreateModal()" style="background: #5b5fc7; color: #ffffff; border: none; border-radius: 8px; padding: 0.5rem 1.1rem; font-weight: 700; font-size: 0.82rem; cursor: pointer; transition: all 0.2s;">Toplantı Oluştur</button>
            <button onclick="Meetings.openQuickMeetingModal()" style="background: #ffffff; color: #475569; border: 1px solid #cbd5e1; border-radius: 8px; padding: 0.5rem 1rem; font-weight: 700; font-size: 0.82rem; cursor: pointer; transition: all 0.2s;">Toplantıya Katıl</button>
          </div>
        </div>
      `;
    } else {
      const participants = liveMeeting.participants || [];
      const maxVisibleAvatars = 5;
      const visibleParticipants = participants.slice(0, maxVisibleAvatars);
      const extraCount = participants.length > maxVisibleAvatars ? participants.length - maxVisibleAvatars : 0;

      let avatarsHtml = '';
      if (participants.length > 0) {
        avatarsHtml = `
          <div style="display: flex; align-items: center; margin-top: 0.6rem; margin-bottom: 0.75rem;">
            ${visibleParticipants.map((p, idx) => `
              <div title="${p.name || ''}" style="width: 32px; height: 32px; border-radius: 50%; background: #e0e7ff; color: #4338ca; border: 2px solid #ffffff; display: flex; align-items: center; justify-content: center; font-size: 0.75rem; font-weight: 800; margin-left: ${idx === 0 ? '0' : '-8px'}; box-shadow: 0 2px 4px rgba(0,0,0,0.06);">
                ${p.avatar ? `<img src="${p.avatar}" style="width:100%; height:100%; border-radius:50%; object-fit:cover;">` : (p.initials || 'U')}
              </div>
            `).join('')}
            ${extraCount > 0 ? `
              <div style="width: 32px; height: 32px; border-radius: 50%; background: #f1f5f9; color: #475569; border: 2px solid #ffffff; display: flex; align-items: center; justify-content: center; font-size: 0.72rem; font-weight: 800; margin-left: -8px;">
                +${extraCount}
              </div>
            ` : ''}
          </div>
        `;
      } else {
        avatarsHtml = `
          <div style="display: flex; align-items: center; margin-top: 0.6rem; margin-bottom: 0.75rem; font-size: 0.78rem; color: #94a3b8; font-weight: 500; gap: 0.35rem;">
            <i class="far fa-user-circle" style="color: #cbd5e1; font-size: 0.9rem;"></i> Odada henüz katılım yok
          </div>
        `;
      }

      contentHtml = `
        <div style="display: flex; gap: 1.2rem; position: relative; height: 100%;">
          <div style="width: 80px; background: #1e1b4b; border-radius: 14px; display: flex; align-items: center; justify-content: center; font-size: 2rem; color: #ffffff; flex-shrink: 0;">
            <i class="fas fa-video"></i>
          </div>

          <div style="flex: 1; display: flex; flex-direction: column; justify-content: space-between;">
            <div>
              <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 0.35rem;">
                <span style="font-size: 0.82rem; font-weight: 700; color: #475569;">Devam Eden Toplantınız</span>
                <div style="display: flex; align-items: center; gap: 0.5rem; position: relative;">
                  <span style="background: #dcfce7; color: #166534; font-size: 0.72rem; font-weight: 800; padding: 0.2rem 0.6rem; border-radius: 6px;">CANLI</span>
                  <span style="background: #f1f5f9; color: #64748b; font-size: 0.68rem; font-weight: 700; padding: 0.2rem 0.55rem; border-radius: 6px;">${liveMeeting.meeting_type || 'Genel Toplantı'}</span>
                  ${Meetings.buildCardMenu(liveMeeting, `dashLive_${liveMeeting.id}`)}
                </div>
              </div>

              <h3 style="font-size: 1.15rem; font-weight: 800; color: #0f172a; margin-bottom: 0.25rem;">
                ${liveMeeting.title}
              </h3>

              <p style="color: #64748b; font-size: 0.85rem; font-weight: 600; margin-bottom: 0.25rem;">
                ${liveMeeting.time_str || 'Canlı Oturum'}
              </p>

              ${avatarsHtml}
            </div>

            <div style="display: flex; gap: 0.75rem;">
              <button onclick="Meetings.openMeetingInNewTab('${liveMeeting.meeting_code}')" style="background: #5b5fc7; color: #ffffff; border: none; border-radius: 9px; padding: 0.6rem 1.3rem; font-weight: 700; font-size: 0.85rem; cursor: pointer; transition: all 0.2s; box-shadow: 0 4px 10px rgba(91, 95, 199, 0.2);">
                Odaya Katıl
              </button>
              <button onclick="Meetings.openDetailsModal('${liveMeeting.id}')" style="background: #ffffff; color: #475569; border: 1px solid #cbd5e1; border-radius: 9px; padding: 0.6rem 1.15rem; font-weight: 700; font-size: 0.85rem; cursor: pointer; transition: all 0.2s;">
                Detaylar
              </button>
            </div>
          </div>
        </div>
      `;
    }

    container.innerHTML = `<div class="fade-in-content" style="height: 100%;">${contentHtml}</div>`;
  },

  renderNextMeetingCard(nextMeeting) {
    const container = document.getElementById('cardNextMeetingContainer');
    if (!container) return;

    let contentHtml = '';
    if (!nextMeeting) {
      contentHtml = `
        <div style="text-align: center; padding: 0.25rem; display: flex; flex-direction: column; align-items: center; justify-content: center; height: 100%;">
          <div style="width: 80px; height: 55px; margin-bottom: 0.5rem; display: flex; align-items: center; justify-content: center;">
            <svg viewBox="0 0 100 80" fill="none" xmlns="http://www.w3.org/2000/svg" style="width: 100%; height: auto;">
              <rect x="15" y="20" width="70" height="50" rx="10" fill="#EEF2FF" stroke="#6366F1" stroke-width="2"/>
              <rect x="15" y="20" width="70" height="15" rx="10" fill="#6366F1"/>
              <circle cx="35" cy="15" r="3" fill="#6366F1"/>
              <circle cx="65" cy="15" r="3" fill="#6366F1"/>
              <circle cx="70" cy="55" r="14" fill="#FFFFFF" stroke="#6366F1" stroke-width="2"/>
              <path d="M70 47V55L75 58" stroke="#6366F1" stroke-width="2" stroke-linecap="round"/>
            </svg>
          </div>
          <h3 style="font-size: 1rem; font-weight: 800; color: #0f172a; margin-bottom: 0.25rem;">Yaklaşan toplantınız yok</h3>
          <p style="color: #64748b; font-size: 0.78rem; max-width: 240px; margin-bottom: 0.85rem; line-height: 1.35;">Toplantı planlayarak zamanınızı verimli yönetin.</p>
          <button onclick="Meetings.openCreateModal()" style="background: #ffffff; color: #475569; border: 1px solid #cbd5e1; border-radius: 8px; padding: 0.45rem 1.1rem; font-weight: 700; font-size: 0.8rem; cursor: pointer; transition: all 0.2s;">Toplantı Planla</button>
        </div>
      `;
    } else {
      const nextIsLive = nextMeeting.status === 'CANLI';
      contentHtml = `
        <div style="display: flex; flex-direction: column; justify-content: space-between; height: 100%;">
          <div>
            <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 0.85rem;">
              <div style="display: flex; align-items: center; gap: 0.75rem;">
                <div style="width: 42px; height: 42px; border-radius: 12px; background: #e0e7ff; color: #5b5fc7; display: flex; align-items: center; justify-content: center; font-size: 1.2rem;">
                  <i class="far fa-calendar-alt"></i>
                </div>
                <span style="font-size: 0.85rem; font-weight: 700; color: #0f172a;">İlk Planlı Toplantınız</span>
              </div>
              <div style="display: flex; align-items: center; gap: 0.5rem; position: relative; flex-shrink: 0;">
                <span style="background: ${nextIsLive ? '#dcfce7' : '#e0e7ff'}; color: ${nextIsLive ? '#166534' : '#3730a3'}; font-size: 0.68rem; font-weight: 800; padding: 0.2rem 0.55rem; border-radius: 6px;">${nextMeeting.status || 'Planlandı'}</span>
                ${Meetings.buildCardMenu(nextMeeting, `dashNext_${nextMeeting.id}`)}
              </div>
            </div>

            <h3 style="font-size: 1.08rem; font-weight: 800; color: #0f172a; margin-bottom: 0.35rem;">
              ${nextMeeting.title}
            </h3>

            <p style="color: #64748b; font-size: 0.85rem; font-weight: 600; margin-bottom: 0.25rem;">
              ${nextMeeting.time_str}
            </p>

            <span style="background: #f1f5f9; color: #64748b; font-size: 0.7rem; font-weight: 700; padding: 0.2rem 0.55rem; border-radius: 6px; display: inline-block; margin-bottom: 1rem;">
              ${nextMeeting.meeting_type || 'Genel Toplantı'}
            </span>
          </div>

          <button onclick="Meetings.openDetailsModal('${nextMeeting.id}')" style="background: #ffffff; color: #475569; border: 1px solid #cbd5e1; border-radius: 9px; padding: 0.6rem 1.1rem; font-weight: 700; font-size: 0.85rem; cursor: pointer; width: 100%; transition: all 0.2s;">
            Detayları Gör
          </button>
        </div>
      `;
    }

    container.innerHTML = `<div class="fade-in-content" style="height: 100%;">${contentHtml}</div>`;
  },

  renderTodayMeetingsList(todayList) {
    const container = document.getElementById('todayMeetingsListContainer');
    if (!container) return;

    let contentHtml = '';
    const displayList = (todayList || []).slice(0, 5);

    if (!displayList || displayList.length === 0) {
      contentHtml = `
        <div style="text-align: center; padding: 1rem 0.25rem; display: flex; flex-direction: column; align-items: center; justify-content: center;">
          <div style="width: 80px; height: 60px; margin-bottom: 0.65rem; display: flex; align-items: center; justify-content: center;">
            <svg viewBox="0 0 100 80" fill="none" xmlns="http://www.w3.org/2000/svg" style="width: 100%; height: auto;">
              <path d="M20 70L35 25H65L80 70H20Z" fill="#EEF2FF" stroke="#5B5FC7" stroke-width="2"/>
              <rect x="25" y="32" width="50" height="30" rx="6" fill="#FFFFFF" stroke="#5B5FC7" stroke-width="1.5"/>
              <circle cx="40" cy="20" r="3" fill="#5B5FC7"/>
              <circle cx="60" cy="20" r="3" fill="#5B5FC7"/>
              <line x1="32" y1="42" x2="68" y1="42" stroke="#CBD5E1" stroke-width="2" stroke-linecap="round"/>
              <line x1="32" y1="50" x2="55" y1="50" stroke="#CBD5E1" stroke-width="2" stroke-linecap="round"/>
            </svg>
          </div>
          <h3 style="font-size: 0.95rem; font-weight: 800; color: #0f172a; margin-bottom: 0.25rem;">Bugün toplantınız yok</h3>
          <p style="color: #64748b; font-size: 0.78rem; max-width: 230px; margin-bottom: 0.85rem; line-height: 1.35;">Gününüzü planlamak için takviminize yeni bir toplantı ekleyin.</p>
          <button onclick="Meetings && Meetings.openCreateModal ? Meetings.openCreateModal() : window.location.href='/meetings'" style="background: #ffffff; color: #475569; border: 1px solid #cbd5e1; border-radius: 8px; padding: 0.45rem 1.1rem; font-weight: 700; font-size: 0.78rem; cursor: pointer; transition: all 0.2s;">Toplantı Planla</button>
        </div>
      `;
    } else {
      // Yeniden tasarım: başlığın altında (renkli değil, gri) toplantı türü;
      // saat, kartın ortasında dijital saat görünümlü bir "chip" içinde.
      contentHtml = displayList.map(m => `
        <div style="display: flex; justify-content: space-between; align-items: center; padding: 0.55rem 0.75rem; background: #f8fafc; border-radius: 10px; border: 1px solid #f1f5f9; margin-bottom: 0.45rem; gap: 0.5rem;">
          <div style="display: flex; align-items: center; gap: 0.65rem; min-width: 0; flex: 1;">
            <i class="far fa-calendar" style="color: #5b5fc7; font-size: 0.9rem; flex-shrink: 0;"></i>
            <div style="min-width: 0;">
              <h4 style="font-size: 0.82rem; font-weight: 700; color: #0f172a; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; margin: 0 0 0.2rem 0;">${m.title}</h4>
              <span style="background: #eef1f5; color: #64748b; font-size: 0.65rem; font-weight: 700; padding: 0.12rem 0.45rem; border-radius: 5px; display: inline-block;">${m.meeting_type || 'Genel Toplantı'}</span>
            </div>
          </div>

          <div style="flex-shrink: 0;">
            <span style="font-size: 0.86rem; font-weight: 800; color: #64748b; font-variant-numeric: tabular-nums; letter-spacing: 0.02em; white-space: nowrap;">
              ${m.time_str}
            </span>
          </div>

          <div style="display: flex; align-items: center; gap: 0.4rem; flex-shrink: 0;">
            <span style="background: ${m.status === 'CANLI' ? '#dcfce7' : '#eff6ff'}; color: ${m.status === 'CANLI' ? '#166534' : '#1d4ed8'}; font-size: 0.65rem; font-weight: 800; padding: 0.15rem 0.4rem; border-radius: 4px;">${m.status}</span>
            <button onclick="Meetings.openMeetingInNewTab('${m.meeting_code}')" style="background: #eeefec; color: #5b5fc7; border: none; border-radius: 6px; padding: 0.3rem 0.65rem; font-weight: 700; font-size: 0.72rem; cursor: pointer;">Katıl</button>
          </div>
        </div>
      `).join('');
    }

    container.innerHTML = `<div class="fade-in-content">${contentHtml}</div>`;
  },

  renderUpcomingMeetingsList(upcomingList) {
    const container = document.getElementById('upcomingMeetingsListContainer');
    if (!container) return;

    let contentHtml = '';
    const displayList = (upcomingList || []).slice(0, 5);

    if (!displayList || displayList.length === 0) {
      contentHtml = `
        <div style="text-align: center; padding: 1rem 0.25rem; display: flex; flex-direction: column; align-items: center; justify-content: center;">
          <div style="width: 85px; height: 60px; margin-bottom: 0.65rem; display: flex; align-items: center; justify-content: center;">
            <svg viewBox="0 0 120 80" fill="none" xmlns="http://www.w3.org/2000/svg" style="width: 100%; height: auto;">
              <ellipse cx="60" cy="70" rx="45" ry="8" fill="#F1F5F9"/>
              <circle cx="42" cy="45" r="22" fill="#5B5FC7" fill-opacity="0.15" stroke="#5B5FC7" stroke-width="3"/>
              <circle cx="78" cy="45" r="22" fill="#5B5FC7" fill-opacity="0.15" stroke="#5B5FC7" stroke-width="3"/>
              <circle cx="42" cy="45" r="14" fill="#3B82F6" fill-opacity="0.2"/>
              <circle cx="78" cy="45" r="14" fill="#3B82F6" fill-opacity="0.2"/>
              <rect x="52" y="40" width="16" height="10" rx="3" fill="#5B5FC7"/>
            </svg>
          </div>
          <h3 style="font-size: 0.95rem; font-weight: 800; color: #0f172a; margin-bottom: 0.25rem;">Yaklaşan toplantı yok</h3>
          <p style="color: #64748b; font-size: 0.78rem; max-width: 230px; margin-bottom: 0.85rem; line-height: 1.35;">Planladığınız toplantılar burada listelenecek.</p>
          <button onclick="Meetings.openCreateModal()" style="background: #ffffff; color: #475569; border: 1px solid #cbd5e1; border-radius: 8px; padding: 0.45rem 1.1rem; font-weight: 700; font-size: 0.78rem; cursor: pointer; transition: all 0.2s;">Toplantı Planla</button>
        </div>
      `;
    } else {
      // Yeniden tasarım: "Bugünkü Toplantılar" kartıyla tutarlı olacak
      // şekilde her satır kendi (gri) kart kutusunda, solda ikon; konum
      // kaldırıldı, başlığın altında (gri) toplantı türü; saat, dijital
      // chip'te ortalı, altında ekstra gün etiketi (date_str) var.
      contentHtml = displayList.map(m => `
        <div style="display: flex; justify-content: space-between; align-items: center; padding: 0.55rem 0.75rem; background: #f8fafc; border-radius: 10px; border: 1px solid #f1f5f9; margin-bottom: 0.45rem; gap: 0.5rem;">
          <div style="display: flex; align-items: center; gap: 0.65rem; min-width: 0; flex: 1;">
            <i class="far fa-calendar" style="color: #5b5fc7; font-size: 0.9rem; flex-shrink: 0;"></i>
            <div style="min-width: 0;">
              <h4 style="font-size: 0.82rem; font-weight: 700; color: #0f172a; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; margin: 0 0 0.2rem 0;">${m.title}</h4>
              <span style="background: #eef1f5; color: #64748b; font-size: 0.65rem; font-weight: 700; padding: 0.12rem 0.45rem; border-radius: 5px; display: inline-block;">${m.meeting_type || 'Genel Toplantı'}</span>
            </div>
          </div>

          <div style="flex-shrink: 0; text-align: center;">
            <span style="font-size: 0.86rem; font-weight: 800; color: #64748b; font-variant-numeric: tabular-nums; letter-spacing: 0.02em; white-space: nowrap; display: block;">
              ${m.time_str}
            </span>
            ${m.date_str ? `<span style="font-size: 0.65rem; color: #94a3b8; font-weight: 600; margin-top: 0.2rem; display: block;">${m.date_str}</span>` : ''}
          </div>

          <button onclick="Meetings.openMeetingInNewTab('${m.meeting_code}')" style="background: #eeefec; color: #5b5fc7; border: none; border-radius: 6px; padding: 0.3rem 0.65rem; font-weight: 700; font-size: 0.72rem; cursor: pointer; flex-shrink: 0;">Katıl</button>
        </div>
      `).join('');
    }

    container.innerHTML = `<div class="fade-in-content">${contentHtml}</div>`;
  },

  renderAgendaTimeline(todayList) {
    const container = document.getElementById('agendaTimelineContainer');
    if (!container) return;

    let itemsHtml = `<div style="display: grid; grid-template-columns: repeat(4, 1fr); gap: 1rem; width: 100%;">`;

    if (todayList && todayList.length > 0) {
      itemsHtml += todayList.map(m => `
        <div style="background: #ffffff; border: 1px solid ${m.status === 'CANLI' ? '#5b5fc7' : '#e2e8f0'}; border-radius: 14px; padding: 1rem; display: flex; align-items: center; gap: 0.85rem; box-shadow: ${m.status === 'CANLI' ? '0 4px 12px rgba(91, 95, 199, 0.08)' : 'none'};">
          <div style="width: 40px; height: 40px; border-radius: 10px; background: #eeefec; color: #5b5fc7; display: flex; align-items: center; justify-content: center; font-size: 1.1rem; flex-shrink: 0;">
            <i class="${m.status === 'CANLI' ? 'fas fa-video' : 'far fa-calendar'}"></i>
          </div>
          <div style="flex: 1; min-width: 0;">
            <span style="font-size: 0.75rem; font-weight: 600; color: #64748b;">${m.time_str}</span>
            <h4 style="font-size: 0.85rem; font-weight: 800; color: #0f172a; margin-top: 0.1rem; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">${m.title}</h4>
          </div>
          <span style="background: ${m.status === 'CANLI' ? '#dcfce7' : '#eff6ff'}; color: ${m.status === 'CANLI' ? '#166534' : '#1d4ed8'}; font-size: 0.65rem; font-weight: 800; padding: 0.15rem 0.4rem; border-radius: 4px;">${m.status}</span>
        </div>
      `).join('');
    }

    itemsHtml += `
      <div onclick="Meetings.openCreateModal()" style="background: #ffffff; border: 2px dashed #cbd5e1; border-radius: 14px; padding: 1rem; display: flex; flex-direction: column; align-items: center; justify-content: center; cursor: pointer; transition: all 0.2s; min-height: 70px;">
        <span style="font-size: 1.2rem; color: #5b5fc7; font-weight: 800;">+</span>
        <span style="font-size: 0.82rem; font-weight: 700; color: #475569;">Toplantı Ekle</span>
      </div>
    </div>`;

    container.innerHTML = itemsHtml;
  }
};

document.addEventListener('DOMContentLoaded', () => {
  Dashboard.init();
});
