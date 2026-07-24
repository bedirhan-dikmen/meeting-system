/* ==========================================================================
   FORMAL CORPORATE MEETING REPORT MODULE
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
        throw new Error("Toplantı katılım raporu yüklenemedi.");
      }

      const report = await response.json();
      this.renderReport(report);
    } catch (err) {
      console.error(err);
      if (window.Notifications) {
        Notifications.show(err.message, 'danger', 'Hata');
      } else {
        alert(err.message);
      }
    }
  },

  renderReport(r) {
    const elTitle = document.getElementById('repTitle');
    const elCode = document.getElementById('repCode');
    const elStart = document.getElementById('repStart');
    const elCreatedDate = document.getElementById('repCreatedDate');
    const elDuration = document.getElementById('repDuration');
    const elParticipantsCount = document.getElementById('repParticipantsCount');
    const elNotesCount = document.getElementById('repNotesCount');
    const elActionsCount = document.getElementById('repActionsCount');

    if (elTitle) elTitle.textContent = r.meeting_title || 'Toplantı Raporu';
    if (elCode) elCode.textContent = r.meeting_code || '-';

    const startDate = r.scheduled_start ? new Date(r.scheduled_start).toLocaleString('tr-TR') : '-';
    if (elStart) elStart.textContent = startDate;
    if (elCreatedDate) elCreatedDate.textContent = new Date().toLocaleDateString('tr-TR');

    if (elDuration) elDuration.textContent = `${r.actual_duration_minutes || 0} dk`;
    if (elParticipantsCount) elParticipantsCount.textContent = `${r.total_participants_count || 0} Personel`;
    if (elNotesCount) elNotesCount.textContent = `${r.total_notes_count || 0} Not`;
    if (elActionsCount) elActionsCount.textContent = `${r.total_actions_count || 0} Karar`;

    // KATILIM CETVELİ TABLOSU
    const tableBody = document.getElementById('repParticipantsTable');
    if (tableBody) {
      if (!r.participants_summary || r.participants_summary.length === 0) {
        tableBody.innerHTML = `<tr><td colspan="4" style="padding: 1rem; text-align: center; color: #64748b;">Katılımcı oturum kaydı bulunmamaktadır.</td></tr>`;
      } else {
        tableBody.innerHTML = r.participants_summary.map(p => `
          <tr style="border-bottom: 1px solid #e2e8f0;">
            <td style="padding: 0.75rem 1rem;"><strong>${p.first_name} ${p.last_name}</strong></td>
            <td style="padding: 0.75rem 1rem; font-family: monospace; color: #0284c7;">${p.user_code || '-'}</td>
            <td style="padding: 0.75rem 1rem; font-weight: 600; color: #1e293b;">${p.total_active_minutes} Dakika</td>
            <td style="padding: 0.75rem 1rem; color: #475569;">${p.total_sessions} Kez Katılım Oturumu Açıldı</td>
          </tr>
        `).join('');
      }
    }

    // TOPLANTI NOTLARI
    const notesContainer = document.getElementById('repNotesList');
    if (notesContainer) {
      if (!r.notes || r.notes.length === 0) {
        notesContainer.innerHTML = `<div style="padding: 0.85rem; background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 6px; color: #64748b; font-size: 0.85rem;">Herhangi bir toplantı notu kaydedilmemiştir.</div>`;
      } else {
        notesContainer.innerHTML = r.notes.map(n => `
          <div style="background: #f8fafc; border: 1px solid #e2e8f0; padding: 0.85rem 1rem; border-radius: 6px;">
            <div style="font-size: 0.78rem; font-weight: 700; color: #0284c7; margin-bottom: 0.25rem;">
              Yayınlayan: ${n.author_name} • ${new Date(n.created_at).toLocaleTimeString('tr-TR')}
            </div>
            <div style="font-size: 0.9rem; color: #1e293b; line-height: 1.4;">${n.content}</div>
          </div>
        `).join('');
      }
    }

    // AKSİYON MADDELERİ
    const actionsContainer = document.getElementById('repActionsList');
    if (actionsContainer) {
      if (!r.actions || r.actions.length === 0) {
        actionsContainer.innerHTML = `<div style="padding: 0.85rem; background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 6px; color: #64748b; font-size: 0.85rem;">Kararlaştırılan aksiyon maddesi bulunmamaktadır.</div>`;
      } else {
        actionsContainer.innerHTML = r.actions.map(a => `
          <div style="background: #f8fafc; border: 1px solid #e2e8f0; padding: 0.85rem 1rem; border-radius: 6px; display: flex; justify-content: space-between; align-items: center;">
            <div>
              <strong style="font-size: 0.9rem; color: #0f172a;">${a.title}</strong>
              ${a.description ? `<p style="font-size: 0.82rem; color: #475569; margin-top: 0.2rem;">${a.description}</p>` : ''}
              <div style="font-size: 0.75rem; color: #0284c7; margin-top: 0.3rem;">Sorumlu Personel: ${a.assigned_to_name || 'Genel'}</div>
            </div>
            <span style="font-size: 0.75rem; padding: 0.25rem 0.6rem; border-radius: 4px; font-weight: 600; background: ${a.is_completed ? '#dcfce7; color: #15803d;' : '#fef3c7; color: #b45309;'};">
              ${a.is_completed ? 'Tamamlandı' : 'İşlem Bekliyor'}
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
