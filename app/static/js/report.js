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
      const response = await Auth.fetchWithAuth(`/api/v1/reports/meeting/${this.meetingId}`);

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

  parseDate(dateStr) {
    if (!dateStr) return new Date();
    if (dateStr instanceof Date) return dateStr;
    if (typeof dateStr === 'string') {
      const cleanStr = dateStr.split('.')[0].replace('Z', '').replace(/[\+\-]\d{2}:\d{2}$/, '');
      const parts = cleanStr.split(/[-T :]/).map(Number);
      if (parts.length >= 5) {
        return new Date(parts[0], parts[1] - 1, parts[2], parts[3], parts[4], parts[5] || 0);
      }
    }
    return new Date(dateStr);
  },

  renderReport(r) {
    const elTitle = document.getElementById('repTitle');
    const elCode = document.getElementById('repCode');
    const elDuration = document.getElementById('repDuration');
    const elParticipantsCount = document.getElementById('repParticipantsCount');
    const elNotesCount = document.getElementById('repNotesCount');

    if (elTitle) elTitle.textContent = r.meeting_title || 'Toplantı Raporu';
    if (elCode) elCode.textContent = r.meeting_code || '-';

    if (elDuration) elDuration.textContent = `${r.actual_duration_minutes || 0} dk`;
    if (elParticipantsCount) elParticipantsCount.textContent = `${r.total_participants_count || 0} Personel`;
    if (elNotesCount) elNotesCount.textContent = `${r.total_notes_count || 0} Not`;

    // --- PRINT META: Düzenlenme Tarihi (her raporlamada o günün tarihi) ---
    const printDate = document.getElementById('repPrintDate');
    if (printDate) {
      printDate.textContent = new Date().toLocaleDateString('tr-TR', {
        day: '2-digit', month: 'long', year: 'numeric'
      });
    }

    // --- PRINT META: Raporlayan (oturumu açan kullanıcı) ---
    const reporterEl = document.getElementById('repReporterName');
    if (reporterEl) {
      const user = Auth.getUser();
      if (user) {
        const fullName = `${user.first_name || ''} ${user.last_name || ''}`.trim();
        reporterEl.textContent = fullName || user.email || '-';
      } else {
        reporterEl.textContent = '-';
      }
    }

    // --- SAĞ ÜSTTE: Gerçek toplantı saati aralığı ve süresi ---
    const timeRow = document.getElementById('repMeetingTimeRow');
    const timeRange = document.getElementById('repMeetingTimeRange');
    const durationEl = document.getElementById('repMeetingDuration');

    if (r.actual_start) {
      const start = this.parseDate(r.actual_start);
      const startStr = start.toLocaleString('tr-TR', { day:'2-digit', month:'2-digit', year:'numeric', hour:'2-digit', minute:'2-digit' });
      let rangeStr = startStr;
      if (r.actual_end) {
        const end = this.parseDate(r.actual_end);
        const endStr = end.toLocaleTimeString('tr-TR', { hour:'2-digit', minute:'2-digit' });
        rangeStr = `${startStr} – ${endStr}`;
      }
      if (timeRow) timeRow.style.display = 'block';
      if (timeRange) timeRange.textContent = rangeStr;
    } else if (r.scheduled_start) {
      const start = this.parseDate(r.scheduled_start);
      const startStr = start.toLocaleString('tr-TR', { day:'2-digit', month:'2-digit', year:'numeric', hour:'2-digit', minute:'2-digit' });
      if (timeRow) timeRow.style.display = 'block';
      if (timeRange) timeRange.textContent = startStr + ' (Planlanan)';
    }

    if (durationEl) {
      durationEl.textContent = r.actual_duration_minutes
        ? `${r.actual_duration_minutes} dk`
        : '-';
    }

    // KATILIM CETVELİ TABLOSU
    const tableBody = document.getElementById('repParticipantsTable');
    if (tableBody) {
      if (!r.participants_summary || r.participants_summary.length === 0) {
        tableBody.innerHTML = `<tr><td colspan="3" style="padding: 1rem; text-align: center; color: #64748b;">Katılımcı oturum kaydı bulunmamaktadır.</td></tr>`;
      } else {
        tableBody.innerHTML = r.participants_summary.map(p => `
          <tr style="border-bottom: 1px solid #e2e8f0;">
            <td style="padding: 0.75rem 1rem;"><strong>${p.first_name} ${p.last_name}</strong></td>
            <td style="padding: 0.75rem 1rem; font-family: monospace; color: #5b5fc7;">${p.user_code || '-'}</td>
            <td style="padding: 0.75rem 1rem; font-weight: 600; color: #1e293b;">${p.total_active_minutes} Dakika</td>
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
            <div style="font-size: 0.78rem; font-weight: 700; color: #5b5fc7; margin-bottom: 0.25rem;">
              Yayınlayan: ${n.author_name} • ${this.parseDate(n.created_at).toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' })}
            </div>
            <div style="font-size: 0.9rem; color: #1e293b; line-height: 1.4;">${n.content}</div>
          </div>
        `).join('');
      }
    }

    // TOPLANTI GÜNDEMİ
    const agendaSection = document.getElementById('repAgendaSection');
    const agendaContent = document.getElementById('repAgendaContent');
    if (r.agenda && r.agenda.trim()) {
      if (agendaSection) agendaSection.style.display = 'block';
      if (agendaContent) agendaContent.textContent = r.agenda.trim();
    } else {
      if (agendaSection) agendaSection.style.display = 'none';
    }
  },

  printReport() {
    window.print();
  }
};

