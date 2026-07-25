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
      const hostName = m.creator ? `${m.creator.first_name || ''} ${m.creator.last_name || ''}`.trim() : 'Yeb Soft';
      const menuId = `dashCardPopover_${m.id}`;

      return `
        <div class="meeting-card" style="background: #ffffff; border: 1px solid #cbd5e1; border-radius: 16px; padding: 1.25rem 1.5rem; display: flex; flex-direction: column; justify-content: space-between; box-shadow: 0 4px 16px rgba(15, 23, 42, 0.04); transition: transform 0.2s ease, box-shadow 0.2s ease; position: relative;">
          
          <!-- TOP ROW: ROUND ICON & THREE DOTS POPOVER -->
          <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 0.85rem;">
            <div style="width: 44px; height: 44px; border-radius: 50%; background: #ecfdf5; color: #10b981; display: flex; align-items: center; justify-content: center; font-size: 1.15rem; flex-shrink: 0;">
              <i class="fas fa-video"></i>
            </div>
            
            <div style="position: relative; display: flex; align-items: center;">
              <button type="button" onclick="Dashboard.toggleCardMenu(event, '${menuId}')" style="background: none; border: none; color: #64748b; font-size: 1.2rem; cursor: pointer; padding: 0.2rem 0.5rem; border-radius: 6px;" title="Seçenekler">
                <i class="fas fa-ellipsis-h"></i>
              </button>

              <!-- THREE DOTS DROPDOWN MENU -->
              <div id="${menuId}" class="teams-dropdown-popover card-popover-menu" style="right: 0; top: 100%; width: 210px; z-index: 500;">
                <button type="button" class="teams-popover-item" onclick="Dashboard.showMeetingInfo('${m.id}')">
                  <i class="fas fa-info-circle" style="color: #0ea5e9;"></i> Toplantı Bilgileri
                </button>
                <button type="button" class="teams-popover-item" onclick="Dashboard.openEditModal('${m.id}')">
                  <i class="fas fa-edit" style="color: #6366f1;"></i> Toplantı Düzenleme
                </button>
                <button type="button" class="teams-popover-item" onclick="Dashboard.cancelMeeting('${m.id}')" style="color: #e11d48;">
                  <i class="fas fa-trash-alt" style="color: #e11d48;"></i> Toplantıyı İptal Et / Sil
                </button>
              </div>
            </div>
          </div>

          <!-- TITLE & CREATOR SUBTITLE -->
          <h4 style="font-size: 1.05rem; font-weight: 800; color: #1e1e1e; margin: 0 0 0.25rem 0; line-height: 1.3;">${m.title}</h4>
          <p style="font-size: 0.82rem; color: #64748b; margin: 0 0 1.25rem 0; font-weight: 500;">
            Oluşturan: <strong style="color: #334155;">${hostName}</strong> • Canlı Oturum
          </p>

          <!-- DUAL ACTION BUTTONS -->
          <div style="display: flex; align-items: center; gap: 0.75rem; margin-top: auto;">
            <a href="/prejoin/${m.meeting_code}" style="background: #059669; color: #ffffff; border-radius: 8px; font-weight: 700; font-size: 0.88rem; padding: 0.6rem 1rem; border: none; flex: 1; text-align: center; text-decoration: none; display: inline-flex; align-items: center; justify-content: center; gap: 0.4rem;">
              <i class="fas fa-video"></i> Katıl
            </a>
            <button type="button" onclick="copyMeetingLink('${m.meeting_code}')" style="background: #f1f5f9; color: #1e1e1e; border-radius: 8px; font-weight: 700; font-size: 0.88rem; padding: 0.6rem 1rem; border: 1px solid #cbd5e1; flex: 1; text-align: center; cursor: pointer;">
              Bağlantıyı paylaş
            </button>
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
    const startStr = new Date(m.scheduled_start).toLocaleString('tr-TR');
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
