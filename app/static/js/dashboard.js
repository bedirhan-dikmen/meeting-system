/* ==========================================================================
   DASHBOARD ANALYTICS & CHARTS MODULE (MS TEAMS EXECUTIVE STYLE)
   ========================================================================== */

const Dashboard = {
  monthlyChart: null,
  typesChart: null,

  async init() {
    await this.loadStats();
    await this.loadLiveMeetings();
  },

  async loadStats() {
    try {
      const response = await Auth.fetchWithAuth('/api/v1/dashboard/stats');

      if (!response.ok) {
        throw new Error("Dashboard istatistikleri çekilemedi.");
      }

      const stats = await response.json();
      this.renderMetrics(stats);
      this.renderCharts(stats.charts);
      this.renderTopParticipants(stats.top_participants);
    } catch (err) {
      console.error(err);
      if (Notifications) Notifications.show(err.message, 'danger', 'Hata');
    }
  },

  async loadLiveMeetings() {
    try {
      const res = await Auth.fetchWithAuth('/api/v1/meetings/active/live');
      if (res.ok) {
        const meetings = await res.json();
        this.renderLiveMeetings(meetings);
      }
    } catch (e) {
      console.warn("Canlı toplantılar çekilemedi:", e);
    }
  },


  renderLiveMeetings(meetings) {
    const section = document.getElementById('dashboardLiveMeetingsSection');
    const container = document.getElementById('dashboardLiveMeetingsList');

    if (!section || !container) return;

    if (!meetings || meetings.length === 0) {
      section.style.display = 'none';
      return;
    }

    section.style.display = 'block';
    container.innerHTML = meetings.map(m => {
      const hostName = m.creator ? `${m.creator.first_name || ''} ${m.creator.last_name || ''}`.trim() : (m.creator_name || 'Yeb Soft');
      const menuId = `dashCardPopover_${m.id}`;
      const activeCount = m.sessions_count || m.active_participants_count || m.current_participants || 1;

      const typeStr = m.meeting_type || 'Genel Toplantı';
      const t = typeStr.toLowerCase();
      let badgeClass = 'badge-type-general';
      if (t.includes('planlı') || t.includes('planlanan')) badgeClass = 'badge-type-planned';
      else if (t.includes('proje')) badgeClass = 'badge-type-project';
      else if (t.includes('günlük') || t.includes('daily') || t.includes('standup')) badgeClass = 'badge-type-daily';
      else if (t.includes('acil') || t.includes('özel') || t.includes('yönetim')) badgeClass = 'badge-type-urgent';

      const now = new Date();
      const dayNum = now.getDate();
      const monthNamesTr = ['Oca', 'Şub', 'Mar', 'Nis', 'May', 'Haz', 'Tem', 'Ağu', 'Eyl', 'Ekim', 'Kas', 'Ara'];
      const dayNamesTr = ['Paz', 'Pzt', 'Sal', 'Çar', 'Per', 'Cum', 'Cmt'];
      const monthStr = monthNamesTr[now.getMonth()];
      const dayNameTr = dayNamesTr[now.getDay()];

      return `
        <div class="meeting-card-teams">
          
          <!-- FAR LEFT: DATE BOX & VERTICAL DIVIDER BAR -->
          <div class="teams-card-left-section">
            <div class="teams-date-box">
              <span class="teams-date-day">${dayNum}</span>
              <span class="teams-date-month">${monthStr}</span>
            </div>
            <div class="teams-vertical-divider teams-divider-live"></div>

            <!-- TITLE & INFO STACK -->
            <div class="teams-card-info-stack">
              <h4 class="teams-card-title teams-card-title-live" title="${m.title}">${m.title}</h4>
              <p class="teams-card-time">Devam Eden Oturum, ${dayNameTr}</p>
              <p class="teams-card-host">Yöneticisi: <strong>${hostName}</strong></p>
            </div>
          </div>

          <!-- MIDDLE BADGES ROW -->
          <div class="teams-card-middle-badges">
            <span class="${badgeClass}"><i class="fas fa-tag"></i> ${typeStr}</span>
            <span class="badge-status-live-pill"><span class="live-pulse-dot"></span> Başladı (Canlı)</span>
            <span class="participant-instant-badge" title="Anlık Katılımcı Sayısı"><i class="fas fa-users"></i> ${activeCount}</span>
          </div>

          <!-- FAR RIGHT ACTIONS & MENU -->
          <div class="teams-card-actions">
            <a href="/prejoin/${m.meeting_code}" class="btn-teams-primary">
              Katıl
            </a>

            <div style="position: relative; display: flex; align-items: center;">
              <button type="button" onclick="Dashboard.toggleCardMenu(event, '${menuId}')" class="card-menu-btn" title="Seçenekler">
                <i class="fas fa-ellipsis-v"></i>
              </button>

              <!-- THREE DOTS DROPDOWN MENU -->
              <div id="${menuId}" class="teams-dropdown-popover card-popover-menu" style="right: 0; top: 100%; width: 200px; z-index: 500;">
                <button type="button" class="teams-popover-item" onclick="Dashboard.showMeetingInfo('${m.id}')">
                  <i class="fas fa-info-circle" style="color: #0f6cbd;"></i> Toplantı Bilgileri
                </button>
                <button type="button" class="teams-popover-item" onclick="Dashboard.openEditModal('${m.id}')">
                  <i class="fas fa-edit" style="color: #5b5fc7;"></i> Toplantı Düzenleme
                </button>
                <button type="button" class="teams-popover-item" onclick="Dashboard.cancelMeeting('${m.id}')" style="color: #c4314b;">
                  <i class="fas fa-trash-alt" style="color: #c4314b;"></i> Toplantıyı İptal Et / Sil
                </button>
              </div>
            </div>
          </div>

        </div>
      `;
    }).join('');
  },

  toggleCardMenu(e, menuId) {
    if (e) {
      e.stopPropagation();
      e.preventDefault();
    }
    const targetPop = document.getElementById(menuId);
    document.querySelectorAll('.teams-dropdown-popover').forEach(p => {
      if (p !== targetPop) p.classList.remove('show');
    });
    if (targetPop) {
      targetPop.classList.toggle('show');
    }
  },

  showMeetingInfo(meetingId) {
    document.querySelectorAll('.teams-dropdown-popover').forEach(p => p.classList.remove('show'));
    const m = (this.liveMeetingsList || []).find(item => item.id === meetingId);
    if (!m) return;
    const hostName = m.creator ? `${m.creator.first_name || ''} ${m.creator.last_name || ''}`.trim() : 'Yeb Soft';
    let startDate = new Date();
    if (m.scheduled_start && typeof m.scheduled_start === 'string') {
      const cleanStr = m.scheduled_start.split('.')[0].replace('Z', '').replace(/[\+\-]\d{2}:\d{2}$/, '');
      const parts = cleanStr.split(/[-T :]/).map(Number);
      if (parts.length >= 5) {
        startDate = new Date(parts[0], parts[1] - 1, parts[2], parts[3], parts[4], parts[5] || 0);
      } else {
        startDate = new Date(m.scheduled_start);
      }
    }
    const startStr = startDate.toLocaleString('tr-TR');
    const msg = `📍 Tür: ${m.meeting_type || 'Canlı Toplantı'}\n🔑 Oda Kodu: ${m.meeting_code}\n👤 Yöneticisi: ${hostName}\n📅 Başlangıç: ${startStr}\n🔒 Şifre: ${m.passcode || 'Yok'}\n📝 Gündem: ${m.agenda || m.description || 'Yok'}`;

    if (window.Notifications) {
      Notifications.show(msg, 'info', `Toplantı Detayı: ${m.title}`);
    } else {
      alert(msg);
    }
  },

  openEditModal(meetingId) {
    document.querySelectorAll('.teams-dropdown-popover').forEach(p => p.classList.remove('show'));
    const m = (this.liveMeetingsList || []).find(item => item.id === meetingId);
    if (!m) return;
    const newTitle = prompt("Toplantı Başlığını Düzenleyin:", m.title);
    if (newTitle === null) return;
    const newDesc = prompt("Toplantı Açıklamasını Düzenleyin:", m.description || '');

    fetch(`/api/v1/meetings/${meetingId}`, {
      method: 'PUT',
      headers: Auth.getAuthHeaders(),
      body: JSON.stringify({
        title: newTitle.trim() || m.title,
        description: newDesc ? newDesc.trim() : m.description
      })
    }).then(res => {
      if (res.ok) {
        Notifications.show("Toplantı bilgileri güncellendi!", "success", "Başarılı");
        this.loadLiveMeetings();
      } else {
        alert("Toplantı güncellenirken hata oluştu.");
      }
    }).catch(err => console.error(err));
  },

  async cancelMeeting(meetingId) {
    document.querySelectorAll('.teams-dropdown-popover').forEach(p => p.classList.remove('show'));
    const m = (this.liveMeetingsList || []).find(item => item.id === meetingId);
    const title = m ? m.title : 'Bu toplantı';

    if (!confirm(`"${title}" toplantısını silmek / iptal etmek istediğinize emin misiniz?`)) return;

    try {
      const res = await fetch(`/api/v1/meetings/${meetingId}`, {
        method: 'PUT',
        headers: Auth.getAuthHeaders(),
        body: JSON.stringify({
          status: 'iptal edildi',
          is_active: false
        })
      });

      if (!res.ok) {
        const errData = await res.json();
        throw new Error(errData.detail || "Toplantı silinemedi.");
      }

      Notifications.show("Toplantı başarıyla silindi ve iptal edildi.", "info", "Toplantı Silindi");
      await this.loadLiveMeetings();
    } catch (err) {
      console.error(err);
      Notifications.show(err.message, "danger", "Hata");
    }
  },

  renderMetrics(stats) {
    const elTotalUsers = document.getElementById('statTotalUsers');
    const elTodayMeetings = document.getElementById('statTodayMeetings');
    const elUpcomingMeetings = document.getElementById('statUpcomingMeetings');
    const elCompletedMeetings = document.getElementById('statCompletedMeetings');
    const elCancelledMeetings = document.getElementById('statCancelledMeetings');
    const elThisMonthMeetings = document.getElementById('statThisMonthMeetings');

    if (elTotalUsers) elTotalUsers.textContent = stats.total_users;
    if (elTodayMeetings) elTodayMeetings.textContent = stats.today_meetings;
    if (elUpcomingMeetings) elUpcomingMeetings.textContent = stats.upcoming_meetings;
    if (elCompletedMeetings) elCompletedMeetings.textContent = stats.completed_meetings;
    if (elCancelledMeetings) elCancelledMeetings.textContent = stats.cancelled_meetings;
    if (elThisMonthMeetings) elThisMonthMeetings.textContent = stats.this_month_meetings;
  },

  renderTopParticipants(users) {
    const container = document.getElementById('topParticipantsList');
    if (!container) return;

    if (!users || users.length === 0) {
      container.innerHTML = `<p style="color: #64748b; font-size: 0.85rem;">Henüz katılım verisi yok.</p>`;
      return;
    }

    container.innerHTML = users.map((u, idx) => `
      <div style="display: flex; align-items: center; justify-content: space-between; padding: 0.65rem 0; border-bottom: 1px solid #f1f5f9;">
        <div style="display: flex; align-items: center; gap: 0.75rem;">
          <span style="font-weight: 800; color: #5b5fc7; font-size: 0.95rem;">#${idx + 1}</span>
          <div>
            <strong style="display: block; font-size: 0.9rem; color: #0f172a;">${u.name}</strong>
            <span style="font-size: 0.75rem; color: #64748b;">${u.email}</span>
          </div>
        </div>
        <div style="text-align: right;">
          <span style="font-size: 0.75rem; font-weight: 700; color: #4f46e5; background: #e0e7ff; padding: 0.15rem 0.5rem; border-radius: 6px;">${u.count} Toplantı</span>
          <span style="font-size: 0.75rem; color: #64748b; display: block; margin-top: 2px;"><i class="far fa-clock" style="color: #d97706; font-size: 0.7rem; margin-right: 2px;"></i>${u.duration_minutes || 0} dk Katılım</span>
        </div>
      </div>
    `).join('');
  },

  renderCharts(chartsData) {
    if (typeof Chart === 'undefined') {
      console.warn("Chart.js kütüphanesi yüklenmedi.");
      return;
    }

    const ctxMonthly = document.getElementById('chartMonthly');
    if (ctxMonthly && chartsData.monthly) {
      if (this.monthlyChart) this.monthlyChart.destroy();

      this.monthlyChart = new Chart(ctxMonthly, {
        type: 'bar',
        data: {
          labels: chartsData.monthly.labels,
          datasets: [{
            label: 'Toplantı Sayısı',
            data: chartsData.monthly.data,
            backgroundColor: 'rgba(91, 95, 199, 0.75)',
            borderColor: '#5b5fc7',
            borderWidth: 2,
            borderRadius: 6
          }]
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          plugins: {
            legend: { display: false }
          },
          scales: {
            y: {
              beginAtZero: true,
              grid: { color: '#f1f5f9' },
              ticks: { color: '#64748b' }
            },
            x: {
              grid: { display: false },
              ticks: { color: '#64748b' }
            }
          }
        }
      });
    }

    const ctxTypes = document.getElementById('chartTypes');
    if (ctxTypes && chartsData.types) {
      if (this.typesChart) this.typesChart.destroy();

      this.typesChart = new Chart(ctxTypes, {
        type: 'doughnut',
        data: {
          labels: chartsData.types.labels,
          datasets: [{
            data: chartsData.types.data,
            backgroundColor: [
              '#5b5fc7',
              '#0ea5e9',
              '#10b981',
              '#d97706',
              '#e11d48',
              '#8b5cf6',
              '#ec4899',
              '#64748b'
            ],
            borderWidth: 0
          }]
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          plugins: {
            legend: {
              position: 'bottom',
              labels: { color: '#475569', font: { size: 11, weight: '600' } }
            }
          }
        }
      });
    }
  }
};

document.addEventListener('DOMContentLoaded', () => {
  Dashboard.init();
});
