/* ==========================================================================
   MEETING MANAGEMENT & FILTERING MODULE
   ========================================================================== */

const Meetings = {
  allMeetings: [],
  allUsers: [],
  allDepartments: [],

  async init() {
    await this.loadUsersAndDepartments();
    await this.loadMeetings();
    this.bindEvents();
  },

  async loadUsersAndDepartments() {
    try {
      const resUsers = await fetch('/api/v1/users/', { headers: Auth.getAuthHeaders() });
      if (resUsers.ok) {
        this.allUsers = await resUsers.json();
        this.populateUserSelects();
      }
    } catch (e) {
      console.warn("Kullanıcılar yüklenemedi (Admin değil ise sınırlı yetki):", e);
    }
  },

  populateUserSelects() {
    const participantSelect = document.getElementById('filterParticipant');
    const hostSelect = document.getElementById('filterHost');
    const userCheckboxesContainer = document.getElementById('modalInvitedUsersList');

    if (hostSelect) {
      hostSelect.innerHTML = `<option value="">Tüm Yöneticiler</option>` +
        this.allUsers.map(u => `<option value="${u.id}">${u.first_name} ${u.last_name}</option>`).join('');
    }

    if (participantSelect) {
      participantSelect.innerHTML = `<option value="">Tüm Katılımcılar</option>` +
        this.allUsers.map(u => `<option value="${u.id}">${u.first_name} ${u.last_name}</option>`).join('');
    }

    if (userCheckboxesContainer) {
      userCheckboxesContainer.innerHTML = this.allUsers.map(u => `
        <label style="display: flex; align-items: center; gap: 0.5rem; font-size: 0.85rem; padding: 0.35rem 0; cursor: pointer;">
          <input type="checkbox" name="invitedUsers" value="${u.id}">
          <span>${u.first_name} ${u.last_name} (${u.email})</span>
        </label>
      `).join('');
    }
  },

  async loadMeetings() {
    try {
      const response = await fetch('/api/v1/meetings/', {
        headers: Auth.getAuthHeaders()
      });

      if (!response.ok) {
        throw new Error("Toplantılar yüklenemedi.");
      }

      this.allMeetings = await response.json();
      this.applyFilters();
    } catch (err) {
      console.error(err);
      Notifications.show(err.message, 'danger', 'Hata');
    }
  },

  applyFilters() {
    const searchTitle = document.getElementById('filterSearch')?.value.toLowerCase().trim() || '';
    const filterHost = document.getElementById('filterHost')?.value || '';
    const filterType = document.getElementById('filterType')?.value || '';
    const filterStatus = document.getElementById('filterStatus')?.value || '';
    const dateFrom = document.getElementById('filterDateFrom')?.value || '';
    const dateTo = document.getElementById('filterDateTo')?.value || '';
    const filterParticipant = document.getElementById('filterParticipant')?.value || '';

    const filtered = this.allMeetings.filter(m => {
      // 1. Başlık ve Açıklama Araması
      if (searchTitle && !m.title.toLowerCase().includes(searchTitle) && !(m.description || '').toLowerCase().includes(searchTitle)) {
        return false;
      }
      // 2. Toplantı Yöneticisi
      if (filterHost && m.created_by !== filterHost) {
        return false;
      }
      // 3. Toplantı Türü
      if (filterType && m.meeting_type !== filterType) {
        return false;
      }
      // 4. Toplantı Durumu
      if (filterStatus && m.status !== filterStatus) {
        return false;
      }
      // 5. Tarih Aralığı
      if (dateFrom && new Date(m.scheduled_start) < new Date(dateFrom)) {
        return false;
      }
      if (dateTo && new Date(m.scheduled_start) > new Date(dateTo + 'T23:59:59')) {
        return false;
      }
      // 6 & 7. Katılımcı Filtresi
      if (filterParticipant) {
        // Katılımcı ID eşleşmesi
      }

      return true;
    });

    this.renderMeetingsList(filtered);
  },

  renderMeetingsList(meetings) {
    const container = document.getElementById('meetingsContainer');
    if (!container) return;

    if (!meetings || meetings.length === 0) {
      container.innerHTML = `
        <div style="grid-column: 1 / -1; text-align: center; padding: 4rem 1rem; color: var(--text-muted);">
          <i class="fas fa-calendar-times" style="font-size: 3rem; margin-bottom: 1rem; opacity: 0.5;"></i>
          <h3>Toplantı Bulunamadı</h3>
          <p>Arama kriterlerinize uygun aktif toplantı bulunmuyor.</p>
        </div>
      `;
      return;
    }

    container.innerHTML = meetings.map(m => {
      const startDate = new Date(m.scheduled_start).toLocaleString('tr-TR', {
        dateStyle: 'medium',
        timeStyle: 'short'
      });

      let statusBadgeClass = 'badge-scheduled';
      let statusText = m.status || 'Planlandı';

      if (m.status === 'başladı') statusBadgeClass = 'badge-started';
      if (m.status === 'tamamlandı') statusBadgeClass = 'badge-completed';
      if (m.status === 'iptal edildi') statusBadgeClass = 'badge-cancelled';
      if (m.status === 'taslak') statusBadgeClass = 'badge-draft';

      return `
        <div class="meeting-card">
          <div class="meeting-header">
            <div>
              <span class="meeting-badge ${statusBadgeClass}">${statusText}</span>
              <span style="font-size: 0.75rem; color: var(--text-secondary); margin-left: 0.5rem;">${m.meeting_type || 'Genel'}</span>
            </div>
            <span style="font-family: monospace; font-size: 0.8rem; background: var(--bg-secondary); padding: 0.2rem 0.5rem; border-radius: 4px; color: var(--accent-cyan);">${m.meeting_code}</span>
          </div>

          <h3 class="meeting-title">${m.title}</h3>
          <p class="meeting-desc">${m.description || 'Açıklama girilmedi.'}</p>

          <div class="meeting-meta">
            <div class="meeting-meta-item">
              <i class="far fa-clock" style="color: var(--accent-primary);"></i>
              <span>${startDate}</span>
            </div>
            ${m.agenda ? `
              <div class="meeting-meta-item">
                <i class="fas fa-list-ul" style="color: var(--accent-cyan);"></i>
                <span style="display: -webkit-box; -webkit-line-clamp: 1; -webkit-box-orient: vertical; overflow: hidden;">${m.agenda}</span>
              </div>
            ` : ''}
          </div>

          <div style="display: flex; gap: 0.5rem; margin-top: auto; padding-top: 0.5rem;">
            <a href="/room/${m.meeting_code}" class="btn btn-primary" style="flex: 1;">
              <i class="fas fa-video"></i> Odaya Katıl
            </a>
            <a href="/reports/${m.id}" class="btn btn-secondary" title="Toplantı Raporu">
              <i class="fas fa-file-alt"></i>
            </a>
          </div>
        </div>
      `;
    }).join('');
  },

  bindEvents() {
    const inputs = ['filterSearch', 'filterHost', 'filterType', 'filterStatus', 'filterDateFrom', 'filterDateTo', 'filterParticipant'];
    inputs.forEach(id => {
      const el = document.getElementById(id);
      if (el) {
        el.addEventListener('input', () => this.applyFilters());
        el.addEventListener('change', () => this.applyFilters());
      }
    });

    const formCreate = document.getElementById('formCreateMeeting');
    if (formCreate) {
      formCreate.addEventListener('submit', (e) => this.handleCreateMeeting(e));
    }
  },

  openCreateModal() {
    const modal = document.getElementById('createMeetingModal');
    if (modal) modal.classList.add('active');
  },

  closeCreateModal() {
    const modal = document.getElementById('createMeetingModal');
    if (modal) modal.classList.remove('active');
  },

  async handleCreateMeeting(e) {
    e.preventDefault();

    const title = document.getElementById('createTitle').value;
    const description = document.getElementById('createDescription').value;
    const scheduled_start = document.getElementById('createStart').value;
    const scheduled_end = document.getElementById('createEnd').value;
    const meeting_type = document.getElementById('createType').value;
    const agenda = document.getElementById('createAgenda').value;
    const status = document.getElementById('createStatus').value;

    const invitedCheckboxes = document.querySelectorAll('input[name="invitedUsers"]:checked');
    const invited_user_ids = Array.from(invitedCheckboxes).map(cb => cb.value);

    try {
      const response = await fetch('/api/v1/meetings/', {
        method: 'POST',
        headers: Auth.getAuthHeaders(),
        body: JSON.stringify({
          title,
          description,
          scheduled_start,
          scheduled_end,
          meeting_type,
          agenda,
          status,
          invited_user_ids
        })
      });

      if (!response.ok) {
        const errData = await response.json();
        throw new Error(errData.detail || "Toplantı oluşturulamadı.");
      }

      Notifications.show('Toplantı başarıyla planlandı ve davetler gönderildi.', 'success', 'Başarılı');
      this.closeCreateModal();
      document.getElementById('formCreateMeeting').reset();
      await this.loadMeetings();
    } catch (err) {
      console.error(err);
      Notifications.show(err.message, 'danger', 'Hata');
    }
  }
};

document.addEventListener('DOMContentLoaded', () => {
  if (window.location.pathname === '/meetings') {
    Meetings.init();
  }
});
