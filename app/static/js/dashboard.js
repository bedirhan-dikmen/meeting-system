/* ==========================================================================
   DASHBOARD ANALYTICS & CHARTS MODULE
   ========================================================================== */

const Dashboard = {
  monthlyChart: null,
  typesChart: null,

  async init() {
    await this.loadStats();
  },

  async loadStats() {
    try {
      const response = await fetch('/api/v1/dashboard/stats', {
        headers: Auth.getAuthHeaders()
      });

      if (!response.ok) {
        throw new Error("Dashboard istatistikleri çekilemedi.");
      }

      const stats = await response.json();
      this.renderMetrics(stats);
      this.renderCharts(stats.charts);
      this.renderTopParticipants(stats.top_participants);
    } catch (err) {
      console.error(err);
      Notifications.show(err.message, 'danger', 'Hata');
    }
  },

  renderMetrics(stats) {
    const elTotalUsers = document.getElementById('statTotalUsers');
    const elTodayMeetings = document.getElementById('statTodayMeetings');
    const elUpcomingMeetings = document.getElementById('statUpcomingMeetings');
    const elCompletedMeetings = document.getElementById('statCompletedMeetings');
    const elCancelledMeetings = document.getElementById('statCancelledMeetings');
    const elThisMonthMeetings = document.getElementById('statThisMonthMeetings');
    const elAvgDuration = document.getElementById('statAvgDuration');

    if (elTotalUsers) elTotalUsers.textContent = stats.total_users;
    if (elTodayMeetings) elTodayMeetings.textContent = stats.today_meetings;
    if (elUpcomingMeetings) elUpcomingMeetings.textContent = stats.upcoming_meetings;
    if (elCompletedMeetings) elCompletedMeetings.textContent = stats.completed_meetings;
    if (elCancelledMeetings) elCancelledMeetings.textContent = stats.cancelled_meetings;
    if (elThisMonthMeetings) elThisMonthMeetings.textContent = stats.this_month_meetings;
    if (elAvgDuration) elAvgDuration.textContent = `${stats.avg_duration_minutes} dk`;
  },

  renderTopParticipants(users) {
    const container = document.getElementById('topParticipantsList');
    if (!container) return;

    if (!users || users.length === 0) {
      container.innerHTML = `<p style="color: var(--text-muted); font-size: 0.85rem;">Henüz katılım verisi yok.</p>`;
      return;
    }

    container.innerHTML = users.map((u, idx) => `
      <div style="display: flex; align-items: center; justify-content: space-between; padding: 0.6rem 0; border-bottom: 1px solid var(--border-color);">
        <div style="display: flex; align-items: center; gap: 0.75rem;">
          <span style="font-weight: 800; color: var(--accent-primary); font-size: 0.9rem;">#${idx + 1}</span>
          <div>
            <strong style="display: block; font-size: 0.9rem;">${u.name}</strong>
            <span style="font-size: 0.75rem; color: var(--text-secondary);">${u.email}</span>
          </div>
        </div>
        <span class="meeting-badge badge-scheduled">${u.count} Toplantı</span>
      </div>
    `).join('');
  },

  renderCharts(chartsData) {
    if (typeof Chart === 'undefined') {
      console.warn("Chart.js kütüphanesi yüklenmedi.");
      return;
    }

    // 1. GRAFİK: Aylara Göre Toplantı Sayısı (Bar/Line Chart)
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
            backgroundColor: 'rgba(99, 102, 241, 0.65)',
            borderColor: '#6366f1',
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
              grid: { color: 'rgba(255, 255, 255, 0.05)' },
              ticks: { color: '#94a3b8' }
            },
            x: {
              grid: { display: false },
              ticks: { color: '#94a3b8' }
            }
          }
        }
      });
    }

    // 2. GRAFİK: Toplantı Türlerine Göre Dağılım (Doughnut Chart)
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
              '#6366f1',
              '#06b6d4',
              '#10b981',
              '#f59e0b',
              '#f43f5e',
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
              labels: { color: '#94a3b8', boxWidth: 12, padding: 15 }
            }
          }
        }
      });
    }
  }
};

document.addEventListener('DOMContentLoaded', () => {
  if (window.location.pathname === '/') {
    Dashboard.init();
  }
});
