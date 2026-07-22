/* ==========================================================================
   MEETING REPORT & ATTENDANCE SUMMARY MODULE
   ========================================================================== */

const Report = {
  meetingId: '',

  async init(meetingId) {
    this.meetingId = meetingId;
    await this.loadReport();
  },

  async loadReport() {
    try {
      const response = await fetch(`/api/v1/reports/meeting/${this.meetingId}`, {
        headers: Auth.getAuthHeaders()
      });

      if (!response.ok) {
        throw new Error("Toplantı raporu yüklenemedi.");
      }

      const report = await response.json();
      this.renderReport(report);
    } catch (err) {
      console.error(err);
      Notifications.show(err.message, 'danger', 'Hata');
    }
  },

  renderReport(r) {
    const elTitle = document.getElementById('repTitle');
    const elCode = document.getElementById('repCode');
    const elStart = document.getElementById('repStart');
    const elDuration = document.getElementById('repDuration');
    const elParticipantsCount = document.getElementById('repParticipantsCount');
    const elNotesCount = document.getElementById('repNotesCount');
    const elActionsCount = document.getElementById('repActionsCount');

    if (elTitle) elTitle.textContent = r.meeting_title;
    if (elCode) elCode.textContent = r.meeting_code;
    if (elStart) elStart.textContent = new Date(r.scheduled_start).toLocaleString('tr-TR');
    if (elDuration) elDuration.textContent = `${r.actual_duration_minutes} dk`;
    if (elParticipantsCount) elParticipantsCount.textContent = r.total_participants_count;
    if (elNotesCount) elNotesCount.textContent = r.total_notes_count;
    if (elActionsCount) elActionsCount.textContent = r.total_actions_count;

    // KATILIM TABLOSU
    const tableBody = document.getElementById('repParticipantsTable');
    if (tableBody) {
      if (!r.participants_summary || r.participants_summary.length === 0) {
        tableBody.innerHTML = `<tr><td colspan="4" style="text-align: center; color: var(--text-muted);">Katılımcı oturum kaydı bulunmuyor.</td></tr>`;
      } else {
        tableBody.innerHTML = r.participants_summary.map(p => `
          <tr>
            <td><strong>${p.first_name} ${p.last_name}</strong></td>
            <td><code>${p.user_code}</code></td>
            <td><span class="meeting-badge badge-scheduled">${p.total_active_minutes} dk</span></td>
            <td>${p.total_sessions} Kez Giriş Yapıldı</td>
          </tr>
        `).join('');
      }
    }

    // TOPLANTI NOTLARI & ALINAN KARARLAR
    const notesContainer = document.getElementById('repNotesList');
    if (notesContainer) {
      if (!r.notes || r.notes.length === 0) {
        notesContainer.innerHTML = `<p style="color: var(--text-muted);">Not eklenmemiş.</p>`;
      } else {
        notesContainer.innerHTML = r.notes.map(n => `
          <div style="background: var(--bg-secondary); border: 1px solid var(--border-color); padding: 1rem; border-radius: var(--radius-md); margin-bottom: 0.75rem;">
            <strong style="display: block; color: var(--accent-cyan); font-size: 0.85rem;">${n.author_name} - ${new Date(n.created_at).toLocaleTimeString('tr-TR')}</strong>
            <p style="margin-top: 0.35rem; font-size: 0.95rem;">${n.content}</p>
          </div>
        `).join('');
      }
    }

    // AKSİYON MADDELERİ
    const actionsContainer = document.getElementById('repActionsList');
    if (actionsContainer) {
      if (!r.actions || r.actions.length === 0) {
        actionsContainer.innerHTML = `<p style="color: var(--text-muted);">Aksiyon maddesi eklenmemiş.</p>`;
      } else {
        actionsContainer.innerHTML = r.actions.map(a => `
          <div style="background: var(--bg-secondary); border: 1px solid var(--border-color); padding: 1rem; border-radius: var(--radius-md); margin-bottom: 0.75rem; display: flex; justify-content: space-between; align-items: center;">
            <div>
              <strong style="font-size: 0.95rem;">${a.title}</strong>
              <p style="font-size: 0.85rem; color: var(--text-secondary);">${a.description || ''}</p>
              <span style="font-size: 0.75rem; color: var(--accent-primary);">Atanan: ${a.assigned_to_name || 'Atanmadı'}</span>
            </div>
            <span class="meeting-badge ${a.is_completed ? 'badge-started' : 'badge-draft'}">
              ${a.is_completed ? 'Tamamlandı' : 'Bekliyor'}
            </span>
          </div>
        `).join('');
      }
    }
  },

  printReport() {
    window.print();
  }
};
