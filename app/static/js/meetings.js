/* ==========================================================================
   MEETING MANAGEMENT & FILTERING MODULE (EXECUTIVE DESIGN)
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

    if (hostSelect) {
      hostSelect.innerHTML = `<option value="">Tüm Yöneticiler</option>` +
        this.allUsers.map(u => `<option value="${u.id}">${u.first_name} ${u.last_name}</option>`).join('');
    }

    if (participantSelect) {
      participantSelect.innerHTML = `<option value="">Tüm Katılımcılar</option>` +
        this.allUsers.map(u => `<option value="${u.id}">${u.first_name} ${u.last_name}</option>`).join('');
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

    const filtered = this.allMeetings.filter(m => {
      if (searchTitle && !m.title.toLowerCase().includes(searchTitle) && !(m.description || '').toLowerCase().includes(searchTitle)) {
        return false;
      }
      if (filterHost && m.created_by !== filterHost) {
        return false;
      }
      if (filterType && m.meeting_type !== filterType) {
        return false;
      }
      if (filterStatus && m.status !== filterStatus) {
        return false;
      }
      if (dateFrom && new Date(m.scheduled_start) < new Date(dateFrom)) {
        return false;
      }
      if (dateTo && new Date(m.scheduled_start) > new Date(dateTo + 'T23:59:59')) {
        return false;
      }

      return true;
    });

    this.renderMeetingsList(filtered);
  },

  renderMeetingsList(meetings) {
    const liveContainer = document.getElementById('liveMeetingsContainer');
    const scheduledContainer = document.getElementById('scheduledMeetingsContainer');
    const liveBadge = document.getElementById('liveCountBadge');
    const scheduledBadge = document.getElementById('scheduledCountBadge');

    if (!liveContainer || !scheduledContainer) return;

    const list = meetings || [];

    const liveMeetings = list.filter(m => {
      const s = (m.status || '').toLowerCase();
      return s === 'canlı' || s === 'başladı' || s === 'active';
    });

    const scheduledMeetings = list.filter(m => {
      const s = (m.status || '').toLowerCase();
      return s !== 'canlı' && s !== 'başladı' && s !== 'active';
    });

    if (liveBadge) liveBadge.textContent = liveMeetings.length;
    if (scheduledBadge) scheduledBadge.textContent = scheduledMeetings.length;

    if (liveMeetings.length === 0) {
      liveContainer.innerHTML = `
        <div style="padding: 1.5rem; background: #ffffff; border: 1px dashed #cbd5e1; border-radius: 12px; color: #64748b; font-size: 0.88rem; text-align: center;">
          <i class="fas fa-broadcast-tower" style="font-size: 1.3rem; margin-bottom: 0.4rem; display: block; color: #94a3b8;"></i>
          Şu an devam eden canlı oturum bulunmuyor.
        </div>
      `;
    } else {
      liveContainer.innerHTML = liveMeetings.map(m => this.createMeetingCardHTML(m, true)).join('');
    }

    if (scheduledMeetings.length === 0) {
      scheduledContainer.innerHTML = `
        <div style="padding: 1.5rem; background: #ffffff; border: 1px dashed #cbd5e1; border-radius: 12px; color: #64748b; font-size: 0.88rem; text-align: center;">
          <i class="fas fa-calendar-times" style="font-size: 1.3rem; margin-bottom: 0.4rem; display: block; color: #94a3b8;"></i>
          Yaklaşan planlı kurumsal toplantı bulunmuyor.
        </div>
      `;
    } else {
      scheduledContainer.innerHTML = scheduledMeetings.map(m => this.createMeetingCardHTML(m, false)).join('');
    }
  },

  createMeetingCardHTML(m, isLive) {
    const currentUser = (typeof Auth !== 'undefined' && Auth.getCurrentUser) ? Auth.getCurrentUser() : null;
    const isOrganizer = (currentUser && (currentUser.id === m.created_by || currentUser.role === 'admin'));

    const startObj = new Date(m.scheduled_start);
    const duration = m.duration_minutes || 30;
    const endObj = new Date(startObj.getTime() + duration * 60 * 1000);

    const startTimeStr = startObj.toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' });
    const endTimeStr = endObj.toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' });
    const dateStr = startObj.toLocaleDateString('tr-TR', { day: '2-digit', month: '2-digit', year: 'numeric' });
    const timeRangeStr = `${startTimeStr} - ${endTimeStr} (${duration} dk)`;

    const hostDisplayName = m.creator ? `${m.creator.first_name || ''} ${m.creator.last_name || ''}`.trim() : 'Yeb Soft';
    const menuId = `cardPopover_${m.id}`;

    // STATUS BADGE
    let statusBadgeHTML = '';
    const status = (m.status || (isLive ? 'canlı' : 'planlandı')).toLowerCase();

    if (status === 'canlı' || status === 'başladı' || isLive) {
      statusBadgeHTML = `<span style="background: #ecfdf5; border: 1px solid #a7f3d0; color: #047857; font-size: 0.76rem; font-weight: 800; padding: 0.2rem 0.65rem; border-radius: 9999px; display: inline-flex; align-items: center; gap: 0.3rem;"><span style="width: 7px; height: 7px; border-radius: 50%; background: #10b981; display: inline-block;"></span>Başladı (Canlı)</span>`;
    } else if (status === 'tamamlandı') {
      statusBadgeHTML = `<span style="background: #d1fae5; border: 1px solid #a7f3d0; color: #065f46; font-size: 0.76rem; font-weight: 800; padding: 0.2rem 0.65rem; border-radius: 9999px;"><i class="fas fa-check-circle"></i> Tamamlandı</span>`;
    } else if (status === 'iptal edildi') {
      statusBadgeHTML = `<span style="background: #ffe4e6; border: 1px solid #fecdd3; color: #be123c; font-size: 0.76rem; font-weight: 800; padding: 0.2rem 0.65rem; border-radius: 9999px;"><i class="fas fa-ban"></i> İptal Edildi</span>`;
    } else if (status === 'taslak') {
      statusBadgeHTML = `<span style="background: #f1f5f9; border: 1px solid #cbd5e1; color: #475569; font-size: 0.76rem; font-weight: 800; padding: 0.2rem 0.65rem; border-radius: 9999px;"><i class="fas fa-file-alt"></i> Taslak</span>`;
    } else {
      statusBadgeHTML = `<span style="background: #e0f2fe; border: 1px solid #bae6fd; color: #0369a1; font-size: 0.76rem; font-weight: 800; padding: 0.2rem 0.65rem; border-radius: 9999px;"><i class="far fa-calendar-alt"></i> Planlandı</span>`;
    }

    const buttonStyle = (isLive || status === 'canlı' || status === 'başladı')
      ? 'background: linear-gradient(135deg, #5b5fc7 0%, #4f46e5 100%); color: #ffffff; box-shadow: 0 4px 14px rgba(91, 95, 199, 0.35);'
      : 'background: #f1f5f9; color: #475569; border: 1px solid #cbd5e1;';

    const buttonText = (isLive || status === 'canlı' || status === 'başladı') ? 'Toplantıya Katıl' : 'Toplantıyı Başlat';
    const buttonIcon = (isLive || status === 'canlı' || status === 'başladı') ? 'fa-door-open' : 'fa-play';

    return `
      <div class="meeting-card-horizontal" style="background: #ffffff; border: 1px solid #e2e8f0; border-radius: 14px; padding: 1.1rem 1.4rem; display: flex; align-items: center; justify-content: space-between; gap: 1.25rem; box-shadow: 0 4px 16px rgba(15, 23, 42, 0.04); transition: all 0.2s ease; position: relative;">
        
        <!-- LEFT COLUMN: ICON, TITLE, HOST & DESCRIPTION PREVIEW -->
        <div style="display: flex; align-items: center; gap: 1rem; min-width: 0; flex: 1.2;">
          <div style="width: 44px; height: 44px; border-radius: 50%; background: ${isLive ? '#d1fae5' : '#e0e7ff'}; color: ${isLive ? '#10b981' : '#5b5fc7'}; display: flex; align-items: center; justify-content: center; font-size: 1.15rem; flex-shrink: 0;">
            <i class="fas ${isLive ? 'fa-video' : 'fa-calendar-day'}"></i>
          </div>

          <div style="min-width: 0; flex: 1;">
            <div style="display: flex; align-items: center; gap: 0.5rem; margin-bottom: 0.2rem;">
              <h4 style="font-size: 1.05rem; font-weight: 800; color: #0f172a; margin: 0; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;" title="${m.title}">${m.title}</h4>
            </div>

            <p style="font-size: 0.82rem; color: #64748b; margin: 0 0 0.2rem 0; font-weight: 500; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">
              Yöneticisi: <strong style="color: #334155;">${hostDisplayName}</strong>
            </p>

            <p style="font-size: 0.8rem; color: #94a3b8; margin: 0; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;" title="${m.description || ''}">
              ${m.description || 'Açıklama belirtilmedi.'}
            </p>
          </div>
        </div>

        <!-- MIDDLE COLUMN: TIMING, TYPE & STATUS BADGES -->
        <div style="display: flex; flex-direction: column; gap: 0.35rem; align-items: flex-start; flex: 1; min-width: 0;">
          <div style="font-size: 0.84rem; font-weight: 700; color: #334155; display: flex; align-items: center; gap: 0.4rem;">
            <i class="far fa-clock" style="color: #5b5fc7;"></i> ${dateStr} • ${timeRangeStr}
          </div>

          <div style="display: flex; align-items: center; gap: 0.5rem; flex-wrap: wrap;">
            <span style="font-size: 0.76rem; font-weight: 700; color: #5b5fc7; background: #e0e7ff; padding: 0.15rem 0.55rem; border-radius: 6px;">
              ${m.meeting_type || 'Genel Toplantı'}
            </span>
            ${statusBadgeHTML}
          </div>
        </div>

        <!-- RIGHT COLUMN: ACTION BUTTON & THREE DOTS POPOVER -->
        <div style="display: flex; align-items: center; gap: 0.75rem; flex-shrink: 0;">
          <a href="/prejoin/${m.meeting_code}" style="${buttonStyle} border-radius: 9px; font-weight: 800; font-size: 0.88rem; padding: 0.6rem 1.1rem; border: none; text-decoration: none; display: inline-flex; align-items: center; gap: 0.4rem; transition: all 0.2s ease;">
            <i class="fas ${buttonIcon}"></i> ${buttonText}
          </a>

          <div style="position: relative; display: flex; align-items: center;">
            <button type="button" onclick="Meetings.toggleCardMenu(event, '${menuId}')" style="background: none; border: none; color: #64748b; font-size: 1.2rem; cursor: pointer; padding: 0.3rem 0.6rem; border-radius: 6px;" title="Seçenekler">
              <i class="fas fa-ellipsis-v"></i>
            </button>

            <!-- THREE DOTS DROPDOWN MENU -->
            <div id="${menuId}" class="teams-dropdown-popover card-popover-menu" style="right: 0; top: 100%; width: 190px;">
              <button type="button" class="teams-popover-item" onclick="Meetings.showMeetingInfo('${m.id}')">
                <i class="fas fa-info-circle" style="color: #0ea5e9;"></i> Bilgiler
              </button>

              ${isOrganizer ? `
                <button type="button" class="teams-popover-item" onclick="Meetings.openEditModal('${m.id}')">
                  <i class="fas fa-edit" style="color: #6366f1;"></i> Düzenle
                </button>
                <button type="button" class="teams-popover-item" onclick="Meetings.cancelMeeting('${m.id}')" style="color: #e11d48;">
                  <i class="fas fa-ban" style="color: #e11d48;"></i> Toplantıyı İptal Et
                </button>
              ` : ''}
            </div>
          </div>
        </div>

      </div>
    `;
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

    const formEdit = document.getElementById('formEditMeeting');
    if (formEdit) {
      formEdit.addEventListener('submit', (e) => this.handleEditMeeting(e));
    }
  },

  openCreateModal() {
    const modal = document.getElementById('createMeetingModal');
    if (modal) modal.classList.add('active');

    const startInput = document.getElementById('createStart');
    if (startInput && !startInput.value) {
      const now = new Date();
      now.setMinutes(now.getMinutes() - now.getTimezoneOffset());
      startInput.value = now.toISOString().slice(0, 16);
    }
  },

  closeCreateModal() {
    const modal = document.getElementById('createMeetingModal');
    if (modal) modal.classList.remove('active');
  },

  openEditModal(meetingId) {
    const meeting = this.allMeetings.find(m => m.id === meetingId);
    if (!meeting) return;

    document.getElementById('editMeetingId').value = meeting.id;
    document.getElementById('editTitle').value = meeting.title || '';
    document.getElementById('editDescription').value = meeting.description || '';
    document.getElementById('editType').value = meeting.meeting_type || 'Genel Toplantı';

    const modal = document.getElementById('editMeetingModal');
    if (modal) modal.classList.add('active');
  },

  closeEditModal() {
    const modal = document.getElementById('editMeetingModal');
    if (modal) modal.classList.remove('active');
  },

  async handleCreateMeeting(e) {
    e.preventDefault();
    const title = document.getElementById('createTitle').value.trim();
    const description = document.getElementById('createDescription').value.trim();
    const scheduledStart = document.getElementById('createStart').value;
    const durationMinutes = parseInt(document.getElementById('createDuration').value || '30', 10);
    const meetingType = document.getElementById('createType').value;

    if (!title || !scheduledStart) {
      Notifications.show("Lütfen gerekli alanları doldurun.", "warning", "Eksik Bilgi");
      return;
    }

    try {
      const res = await fetch('/api/v1/meetings/', {
        method: 'POST',
        headers: Auth.getAuthHeaders(),
        body: JSON.stringify({
          title,
          description,
          scheduled_start: new Date(scheduledStart).toISOString(),
          duration_minutes: durationMinutes,
          meeting_type: meetingType,
          status: 'planlandı'
        })
      });

      if (!res.ok) {
        const errData = await res.json();
        throw new Error(errData.detail || "Toplantı oluşturulamadı.");
      }

      Notifications.show("Toplantı başarıyla oluşturuldu!", "success", "Başarılı");
      this.closeCreateModal();
      await this.loadMeetings();
    } catch (err) {
      console.error(err);
      Notifications.show(err.message, "danger", "Hata");
    }
  },

  async handleEditMeeting(e) {
    e.preventDefault();
    const meetingId = document.getElementById('editMeetingId').value;
    const title = document.getElementById('editTitle').value.trim();
    const description = document.getElementById('editDescription').value.trim();
    const meetingType = document.getElementById('editType').value;

    try {
      const res = await fetch(`/api/v1/meetings/${meetingId}`, {
        method: 'PUT',
        headers: Auth.getAuthHeaders(),
        body: JSON.stringify({
          title,
          description,
          meeting_type: meetingType
        })
      });

      if (!res.ok) {
        const errData = await res.json();
        throw new Error(errData.detail || "Toplantı güncellenemedi.");
      }

      Notifications.show("Toplantı başarıyla güncellendi!", "success", "Başarılı");
      this.closeEditModal();
      await this.loadMeetings();
    } catch (err) {
      console.error(err);
      Notifications.show(err.message, "danger", "Hata");
    }
  },

  async cancelMeeting(meetingId) {
    if (!confirm("Bu toplantıyı iptal etmek istediğinize emin misiniz?")) return;

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
        throw new Error(errData.detail || "Toplantı iptal edilemedi.");
      }

      Notifications.show("Toplantı iptal edildi.", "info", "İptal Edildi");
      await this.loadMeetings();
    } catch (err) {
      console.error(err);
      Notifications.show(err.message, "danger", "Hata");
    }
  }
};

document.addEventListener('DOMContentLoaded', () => {
  Meetings.init();
});
