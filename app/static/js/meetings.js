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
      this.renderInvitedUsersList(this.allUsers);
    }
  },

  renderInvitedUsersList(usersToRender) {
    const userCheckboxesContainer = document.getElementById('modalInvitedUsersList');
    if (!userCheckboxesContainer) return;

    if (!usersToRender || usersToRender.length === 0) {
      userCheckboxesContainer.innerHTML = `<p style="font-size: 0.85rem; color: #94a3b8; padding: 0.5rem 0;">Aramaya uygun kullanıcı bulunamadı.</p>`;
      return;
    }

    userCheckboxesContainer.innerHTML = usersToRender.map(u => `
      <label class="invited-user-row" style="display: flex; align-items: center; justify-content: space-between; font-size: 0.85rem; padding: 0.4rem 0.2rem; cursor: pointer; border-bottom: 1px solid #f1f5f9;">
        <div style="display: flex; align-items: center; gap: 0.6rem;">
          <input type="checkbox" name="invitedUsers" value="${u.id}" onchange="Meetings.updateSelectedCount()" style="accent-color: #10b981; width: 16px; height: 16px;">
          <span style="color: #334155; font-weight: 600;">${u.first_name || ''} ${u.last_name || ''}</span>
          <small style="color: #94a3b8;">(${u.email})</small>
        </div>
        <span style="font-size: 0.72rem; color: #6366f1; background: rgba(99, 102, 241, 0.08); padding: 0.1rem 0.4rem; border-radius: 4px;">${u.role || 'Kullanıcı'}</span>
      </label>
    `).join('');

    this.updateSelectedCount();
  },

  filterInvitedUsersList() {
    const query = document.getElementById('searchInvitedUsers')?.value.toLowerCase().trim() || '';
    if (!query) {
      this.renderInvitedUsersList(this.allUsers);
      return;
    }

    const filtered = this.allUsers.filter(u => {
      const name = `${u.first_name || ''} ${u.last_name || ''}`.toLowerCase();
      const email = (u.email || '').toLowerCase();
      const code = (u.user_code || '').toLowerCase();
      return name.includes(query) || email.includes(query) || code.includes(query);
    });

    this.renderInvitedUsersList(filtered);
  },

  updateSelectedCount() {
    const selectedBoxes = document.querySelectorAll('#modalInvitedUsersList input[name="invitedUsers"]:checked');
    const badge = document.getElementById('selectedCountBadge');
    if (badge) {
      badge.textContent = `${selectedBoxes.length} Seçili`;
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
        // Katılımcı ID kontrolü gerekirse
      }

      return true;
    });

    this.renderMeetingsList(filtered);
  },

  renderMeetingsList(meetings) {
    const liveContainer = document.getElementById('liveMeetingsContainer');
    const scheduledContainer = document.getElementById('scheduledMeetingsContainer');

    if (!liveContainer || !scheduledContainer) return;

    const activeOrScheduled = (meetings || []).filter(m => m.status !== 'tamamlandı' && m.status !== 'iptal edildi');
    
    const liveMeetings = activeOrScheduled.filter(m => m.status === 'ACTIVE' || m.status === 'başladı');
    const scheduledMeetings = activeOrScheduled.filter(m => m.status === 'planlandı' || m.status === 'taslak');

    // 1. CANLI TOPLANTILAR RENDER
    if (liveMeetings.length === 0) {
      liveContainer.innerHTML = `
        <div style="grid-column: 1 / -1; padding: 2rem; background: #ffffff; border: 1px dashed #cbd5e1; border-radius: 12px; color: #64748b; font-size: 0.9rem; text-align: center;">
          <i class="fas fa-video-slash" style="font-size: 1.5rem; margin-bottom: 0.5rem; display: block; color: #94a3b8;"></i>
          Şu an devam eden canlı oturum bulunmuyor.
        </div>
      `;
    } else {
      liveContainer.innerHTML = liveMeetings.map(m => this.createMeetingCardHTML(m, true)).join('');
    }

    // 2. PLANLANAN TOPLANTILAR RENDER
    if (scheduledMeetings.length === 0) {
      scheduledContainer.innerHTML = `
        <div style="grid-column: 1 / -1; padding: 2rem; background: #ffffff; border: 1px dashed #cbd5e1; border-radius: 12px; color: #64748b; font-size: 0.9rem; text-align: center;">
          <i class="fas fa-calendar-times" style="font-size: 1.5rem; margin-bottom: 0.5rem; display: block; color: #94a3b8;"></i>
          Yaklaşan planlı kurumsal toplantı bulunmuyor.
        </div>
      `;
    } else {
      scheduledContainer.innerHTML = scheduledMeetings.map(m => this.createMeetingCardHTML(m, false)).join('');
    }
  },

  createMeetingCardHTML(m, isLive) {
    const startDate = new Date(m.scheduled_start).toLocaleString('tr-TR', {
      dateStyle: 'medium',
      timeStyle: 'short'
    });

    const cardBorderStyle = isLive 
      ? 'border: 1px solid #10b981; box-shadow: 0 10px 25px -5px rgba(16, 185, 129, 0.12); background: linear-gradient(180deg, #f0fdf4 0%, #ffffff 100%);' 
      : 'border: 1px solid #e2e8f0; box-shadow: 0 4px 16px rgba(15, 23, 42, 0.04); background: #ffffff;';

    const statusBadgeHTML = isLive
      ? `<span style="background: #ecfdf5; border: 1px solid #a7f3d0; color: #047857; border-radius: 20px; padding: 0.25rem 0.75rem; font-weight: 700; font-size: 0.75rem; display: inline-flex; align-items: center; gap: 0.35rem;">
           <span style="width: 7px; height: 7px; border-radius: 50%; background: #10b981; display: inline-block;"></span>
           Canlı Oturum
         </span>`
      : `<span style="background: #e0f2fe; border: 1px solid #bae6fd; color: #0369a1; border-radius: 20px; padding: 0.25rem 0.75rem; font-weight: 700; font-size: 0.75rem;">
           ${m.status || 'Planlandı'}
         </span>`;

    const btnClassStyle = isLive
      ? 'background: linear-gradient(135deg, #10b981 0%, #059669 100%); color: #ffffff; box-shadow: 0 4px 12px rgba(16, 185, 129, 0.3);'
      : 'background: linear-gradient(135deg, #4f46e5 0%, #2563eb 100%); color: #ffffff; box-shadow: 0 4px 12px rgba(79, 70, 229, 0.25);';

    return `
      <div class="meeting-card" style="${cardBorderStyle} border-radius: 14px; padding: 1.5rem; display: flex; flex-direction: column; transition: all 0.2s ease;">
        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 0.85rem; gap: 0.5rem; flex-wrap: wrap;">
          <div style="display: flex; align-items: center; gap: 0.5rem;">
            ${statusBadgeHTML}
            <span style="font-size: 0.75rem; color: #64748b; font-weight: 600; background: #f1f5f9; padding: 0.2rem 0.5rem; border-radius: 6px;">${m.meeting_type || 'Genel'}</span>
          </div>
          <span style="font-family: monospace; font-size: 0.8rem; background: #f8fafc; border: 1px solid #e2e8f0; padding: 0.2rem 0.6rem; border-radius: 6px; color: #0284c7; font-weight: 700;">${m.meeting_code}</span>
        </div>

        <h3 style="font-size: 1.1rem; font-weight: 800; color: #0f172a; margin: 0 0 0.4rem 0; line-height: 1.3;">${m.title}</h3>
        <p style="font-size: 0.85rem; color: #64748b; margin: 0 0 1rem 0; line-height: 1.4; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden;">${m.description || 'Açıklama girilmedi.'}</p>

        <div style="margin-top: auto; border-top: 1px solid #f1f5f9; padding-top: 1rem; display: flex; flex-direction: column; gap: 0.5rem;">
          <div style="display: flex; align-items: center; gap: 0.5rem; font-size: 0.82rem; color: #475569;">
            <i class="far fa-clock" style="color: #6366f1; font-size: 0.9rem;"></i>
            <span>${startDate}</span>
          </div>
          ${m.agenda ? `
            <div style="display: flex; align-items: center; gap: 0.5rem; font-size: 0.82rem; color: #475569;">
              <i class="fas fa-list-ul" style="color: #0ea5e9; font-size: 0.85rem;"></i>
              <span style="display: -webkit-box; -webkit-line-clamp: 1; -webkit-box-orient: vertical; overflow: hidden;">${m.agenda}</span>
            </div>
          ` : ''}
        </div>

        <div style="margin-top: 1.25rem;">
          <a href="/room/${m.meeting_code}" class="btn" style="${btnClassStyle} width: 100%; text-align: center; justify-content: center; border-radius: 8px; font-weight: 700; padding: 0.7rem 1rem; border: none; font-size: 0.9rem; display: inline-flex; align-items: center; gap: 0.5rem;">
            <i class="fas ${isLive ? 'fa-door-open' : 'fa-video'}"></i> ${isLive ? 'Canlı Oturuma Katıl' : 'Toplantıyı Başlat / Katıl'}
          </a>
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
    this.onStartChange();
  },

  closeCreateModal() {
    const modal = document.getElementById('createMeetingModal');
    if (modal) modal.classList.remove('active');
  },

  onStartChange() {
    const startInput = document.getElementById('createStart');
    const durationInput = document.getElementById('createDuration');
    const endInput = document.getElementById('createEnd');

    if (!startInput || !startInput.value || !durationInput || !endInput) return;

    const startDate = new Date(startInput.value);
    const durationMins = parseInt(durationInput.value || '30', 10);

    const endDate = new Date(startDate.getTime() + durationMins * 60000);
    endDate.setMinutes(endDate.getMinutes() - endDate.getTimezoneOffset());

    endInput.value = endDate.toISOString().slice(0, 16);
  },

  generatePasscode() {
    const passcodeEl = document.getElementById('createPasscode');
    if (passcodeEl) {
      const code = Math.floor(100000 + Math.random() * 900000).toString();
      passcodeEl.value = code;
    }
  },

  async handleCreateMeeting(e) {
    e.preventDefault();

    const title = document.getElementById('createTitle').value;
    const description = document.getElementById('createDescription').value;
    const startVal = document.getElementById('createStart').value;
    const endVal = document.getElementById('createEnd').value;

    const duration_minutes = parseInt(document.getElementById('createDuration')?.value || '30', 10);
    const meeting_type = document.getElementById('createType')?.value || 'Planlı Toplantı';
    const passcode = document.getElementById('createPasscode')?.value || null;
    const lobby_enabled = document.getElementById('createLobby')?.checked || false;
    const is_private = document.getElementById('createPrivate')?.checked || false;
    const agenda = document.getElementById('createAgenda')?.value || '';

    const invitedBoxes = document.querySelectorAll('#modalInvitedUsersList input[name="invitedUsers"]:checked');
    const invited_user_ids = Array.from(invitedBoxes).map(cb => cb.value);

    const scheduled_start = startVal ? new Date(startVal).toISOString() : new Date().toISOString();
    const scheduled_end = endVal ? new Date(endVal).toISOString() : null;

    try {
      const response = await fetch('/api/v1/meetings/', {
        method: 'POST',
        headers: Auth.getAuthHeaders(),
        body: JSON.stringify({
          title,
          description,
          scheduled_start,
          scheduled_end,
          duration_minutes,
          meeting_type,
          agenda,
          passcode,
          lobby_enabled,
          is_private,
          status: "planlandı",
          invited_user_ids
        })
      });

      if (!response.ok) {
        let errorMsg = "Toplantı oluşturulamadı.";
        try {
          const errData = await response.json();
          errorMsg = errData.detail || errorMsg;
        } catch (e) {
          errorMsg = `Sunucu Hatası (${response.status}): ${response.statusText || 'Bilinmeyen Hata'}`;
        }
        throw new Error(errorMsg);
      }

      const createdMeeting = await response.json();
      Notifications.show('Toplantı başarıyla planlandı ve davetler gönderildi.', 'success', 'Başarılı');
      this.closeCreateModal();
      document.getElementById('formCreateMeeting').reset();
      await this.loadMeetings();

      if (meeting_type === 'Anlık Toplantı') {
        window.location.href = `/room/${createdMeeting.meeting_code}`;
      }
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
