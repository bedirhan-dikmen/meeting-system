/* ==========================================================================
   DASHBOARD DYNAMIC DATA & VISUAL EMPTY STATE MODULE (V6 - NEW MOCKUP)
   ========================================================================== */

// Global Meetings helper fallback
window.Meetings = window.Meetings || {
  openCreateModal: function() {
    window.location.href = '/meetings?action=create';
  },
  openQuickMeetingModal: function() {
    window.location.href = '/meetings?action=quick';
  }
};

const Dashboard = {
  async init() {
    this.updateUserGreetingAndDate();
    await this.loadStats();
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
        this.renderMetrics(stats);
        if (stats.live_meeting) this.renderLiveMeetingCard(stats.live_meeting);
        if (stats.next_meeting) this.renderNextMeetingCard(stats.next_meeting);
        if (stats.today_list && stats.today_list.length > 0) this.renderTodayMeetingsList(stats.today_list);
        if (stats.upcoming_list && stats.upcoming_list.length > 0) this.renderUpcomingMeetingsList(stats.upcoming_list);
        if (stats.today_list && stats.today_list.length > 0) this.renderAgendaTimeline(stats.today_list);
      }
    } catch (err) {
      console.warn("Dashboard verileri yüklenirken uyarı (Boş durum şablonu korundu):", err);
    }
  },

  renderMetrics(stats) {
    const elToday = document.getElementById('statCountToday');
    const elScheduled = document.getElementById('statCountScheduled');
    const elCompleted = document.getElementById('statCountCompleted');
    const elHours = document.getElementById('statCountHours');

    if (elToday && stats.today_meetings !== undefined) elToday.textContent = stats.today_meetings;
    if (elScheduled && stats.upcoming_meetings !== undefined) elScheduled.textContent = stats.upcoming_meetings;
    if (elCompleted && stats.completed_meetings !== undefined) elCompleted.textContent = stats.completed_meetings;
    if (elHours && stats.total_duration_hours !== undefined) elHours.textContent = `${stats.total_duration_hours} saat`;
  },

  renderLiveMeetingCard(liveMeeting) {
    const container = document.getElementById('cardLiveMeetingContainer');
    if (!container || !liveMeeting) return;

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

    container.innerHTML = `
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
                <button onclick="Meetings.toggleCardMenu(event, 'dashLive_${liveMeeting.id}')" style="background: none; border: none; font-size: 1rem; color: #64748b; cursor: pointer; padding: 0.2rem 0.35rem; border-radius: 6px;" title="Seçenekler">
                  <i class="fas fa-ellipsis-v"></i>
                </button>
                <div id="cardMenu_dashLive_${liveMeeting.id}" class="card-dropdown-menu" style="display: none; position: absolute; top: 100%; right: 0; background: #ffffff; border: 1px solid #e2e8f0; border-radius: 10px; box-shadow: 0 10px 25px rgba(0,0,0,0.12); width: 210px; z-index: 1000; padding: 0.4rem 0;">
                  <button onclick="Meetings.openEditModal('${liveMeeting.id}')" style="width: 100%; text-align: left; background: none; border: none; padding: 0.6rem 1rem; font-size: 0.85rem; font-weight: 600; color: #334155; cursor: pointer; display: flex; align-items: center; gap: 0.6rem;">
                    <i class="far fa-edit" style="color: #6366f1;"></i> Toplantı Bilgilerini Düzenle
                  </button>
                  <button onclick="Meetings.cancelMeeting('${liveMeeting.id}')" style="width: 100%; text-align: left; background: none; border: none; padding: 0.6rem 1rem; font-size: 0.85rem; font-weight: 600; color: #ef4444; cursor: pointer; display: flex; align-items: center; gap: 0.6rem; border-top: 1px solid #f1f5f9;">
                    <i class="far fa-times-circle" style="color: #ef4444;"></i> Toplantıyı İptal Et
                  </button>
                </div>
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
            <button onclick="window.location.href='/prejoin/${liveMeeting.meeting_code}'" style="background: #5b5fc7; color: #ffffff; border: none; border-radius: 9px; padding: 0.6rem 1.3rem; font-weight: 700; font-size: 0.85rem; cursor: pointer; transition: all 0.2s; box-shadow: 0 4px 10px rgba(91, 95, 199, 0.2);">
              Odaya Katıl
            </button>
            <button onclick="Meetings.openDetailsModal('${liveMeeting.id}')" style="background: #ffffff; color: #475569; border: 1px solid #cbd5e1; border-radius: 9px; padding: 0.6rem 1.15rem; font-weight: 700; font-size: 0.85rem; cursor: pointer; transition: all 0.2s;">
              Detaylar
            </button>
          </div>
        </div>
      </div>
    `;
  },

  renderNextMeetingCard(nextMeeting) {
    const container = document.getElementById('cardNextMeetingContainer');
    if (!container || !nextMeeting) return;

    container.innerHTML = `
      <div style="display: flex; flex-direction: column; justify-content: space-between; height: 100%;">
        <div>
          <div style="display: flex; align-items: center; gap: 0.75rem; margin-bottom: 0.85rem;">
            <div style="width: 42px; height: 42px; border-radius: 12px; background: #e0e7ff; color: #5b5fc7; display: flex; align-items: center; justify-content: center; font-size: 1.2rem;">
              <i class="far fa-calendar-alt"></i>
            </div>
            <span style="font-size: 0.85rem; font-weight: 700; color: #0f172a;">İlk Planlı Toplantınız</span>
          </div>

          <h3 style="font-size: 1.08rem; font-weight: 800; color: #0f172a; margin-bottom: 0.35rem;">
            ${nextMeeting.title}
          </h3>

          <p style="color: #64748b; font-size: 0.85rem; font-weight: 600; margin-bottom: 0.4rem;">
            ${nextMeeting.time_str}
          </p>

          <p style="color: #64748b; font-size: 0.82rem; display: flex; align-items: center; gap: 0.35rem; margin-bottom: 1rem;">
            <i class="fas fa-map-marker-alt" style="color: #94a3b8;"></i> ${nextMeeting.location}
          </p>
        </div>

        <button onclick="window.location.href='/meetings'" style="background: #ffffff; color: #475569; border: 1px solid #cbd5e1; border-radius: 9px; padding: 0.6rem 1.1rem; font-weight: 700; font-size: 0.85rem; cursor: pointer; width: 100%; transition: all 0.2s;">
          Detayları Gör
        </button>
      </div>
    `;
  },

  renderTodayMeetingsList(todayList) {
    const container = document.getElementById('todayMeetingsListContainer');
    if (!container || !todayList) return;

    container.innerHTML = todayList.map(m => `
      <div style="display: flex; justify-content: space-between; align-items: center; padding: 0.75rem; background: #f8fafc; border-radius: 10px; border: 1px solid #f1f5f9; margin-bottom: 0.75rem;">
        <div style="display: flex; align-items: center; gap: 0.75rem;">
          <i class="far fa-calendar" style="color: #5b5fc7; font-size: 1rem;"></i>
          <div>
            <h4 style="font-size: 0.85rem; font-weight: 700; color: #0f172a;">${m.title}</h4>
            <span style="font-size: 0.75rem; color: #64748b;">${m.time_str}</span>
          </div>
        </div>
        <div style="display: flex; align-items: center; gap: 0.5rem;">
          <span style="background: ${m.status === 'CANLI' ? '#dcfce7' : '#eff6ff'}; color: ${m.status === 'CANLI' ? '#166534' : '#1d4ed8'}; font-size: 0.68rem; font-weight: 800; padding: 0.15rem 0.45rem; border-radius: 4px;">${m.status}</span>
          <button onclick="window.location.href='/prejoin/${m.meeting_code}'" style="background: #eeefec; color: #5b5fc7; border: none; border-radius: 6px; padding: 0.35rem 0.75rem; font-weight: 700; font-size: 0.75rem; cursor: pointer;">Katıl</button>
        </div>
      </div>
    `).join('');
  },

  renderUpcomingMeetingsList(upcomingList) {
    const container = document.getElementById('upcomingMeetingsListContainer');
    if (!container || !upcomingList) return;

    container.innerHTML = upcomingList.map((m, idx) => `
      <div style="display: flex; justify-content: space-between; align-items: center; padding: 0.65rem 0; ${idx < upcomingList.length - 1 ? 'border-bottom: 1px solid #f1f5f9;' : ''}">
        <div>
          <h4 style="font-size: 0.85rem; font-weight: 700; color: #0f172a;">${m.title}</h4>
          <span style="font-size: 0.75rem; color: #64748b; display: block;">${m.time_str}</span>
          <span style="font-size: 0.72rem; color: #94a3b8;"><i class="fas fa-map-marker-alt"></i> ${m.location}</span>
        </div>
        <button onclick="window.location.href='/prejoin/${m.meeting_code}'" style="background: #f1f5f9; color: #4f46e5; border: none; border-radius: 6px; padding: 0.35rem 0.75rem; font-weight: 700; font-size: 0.75rem; cursor: pointer;">Katıl</button>
      </div>
    `).join('');
  },

  renderAgendaTimeline(todayList) {
    const container = document.getElementById('agendaTimelineContainer');
    if (!container || !todayList) return;

    let itemsHtml = `<div style="display: grid; grid-template-columns: repeat(4, 1fr); gap: 1rem; width: 100%;">`;
    
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
