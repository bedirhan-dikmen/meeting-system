// ============================================
// REPORT.JS - AKILLI VE ZIRHLI RAPOR YÜKLEYİCİ
// ============================================

const API_BASE = 'http://localhost:8000/api/v1';
const token = localStorage.getItem('token');

if (!token) {
    window.location.href = '/';
}

async function loadMeetingReport() {
    const container = document.getElementById('reportContent');
    if (!container) return;

    // URL'den Parametreyi Çek (ID veya Kod Olabilir)
    const pathSegments = window.location.pathname.split('/').filter(Boolean);
    const param = pathSegments.pop();

    if (!param || param === 'report' || param === 'null') {
        container.innerHTML = `
            <div class="alert alert-warning text-center p-4">
                <h5 class="fw-bold">⚠️ Geçersiz Toplantı Bilgisi</h5>
                <p class="mb-0">Rapor çekilecek toplantı kimliği (ID/Kod) adreste bulunamadı.</p>
            </div>
        `;
        return;
    }

    let reportData = null;

    // 1. DENEME: /reports/meeting/{param}
    try {
        const res1 = await fetch(`${API_BASE}/reports/meeting/${param}`, {
            headers: { 'Authorization': `Bearer ${token}` }
        });
        if (res1.ok) reportData = await res1.json();
    } catch (e) {}

    // 2. DENEME: /reports/{param}
    if (!reportData) {
        try {
            const res2 = await fetch(`${API_BASE}/reports/${param}`, {
                headers: { 'Authorization': `Bearer ${token}` }
            });
            if (res2.ok) reportData = await res2.json();
        } catch (e) {}
    }

    // 3. DENEME: Parametre 'yeb-xxxx-xxxx' Oda Kodu ise, önce ID'yi bulup sonra raporu iste!
    if (!reportData && param.startsWith('yeb-')) {
        try {
            const codeRes = await fetch(`${API_BASE}/meetings/code/${param}`, {
                headers: { 'Authorization': `Bearer ${token}` }
            });
            if (codeRes.ok) {
                const meetingObj = await codeRes.json();
                const realId = meetingObj.id;

                const res3 = await fetch(`${API_BASE}/reports/meeting/${realId}`, {
                    headers: { 'Authorization': `Bearer ${token}` }
                });
                if (res3.ok) reportData = await res3.json();
            }
        } catch (e) {}
    }

    // EĞER HÂLÂ BAZI NEDENLERDEN BULUNAMADIYSA:
    if (!reportData) {
        container.innerHTML = `
            <div class="alert alert-danger text-center p-4">
                <h5 class="fw-bold">❌ Toplantı Raporu Bulunamadı</h5>
                <p class="text-muted small mb-3">İstenen toplantı kaydı veritabanında oluşmamış olabilir veya API sunucusuna erişilemiyor.</p>
                <div class="d-flex justify-content-center gap-2">
                    <button onclick="location.reload()" class="btn btn-outline-danger btn-sm fw-semibold">🔄 Yeniden Dene</button>
                    <button onclick="window.location.href='/dashboard'" class="btn btn-secondary btn-sm fw-semibold">Kontrol Paneline Dön</button>
                </div>
            </div>
        `;
        return;
    }

    // VERİ BAŞARIYLA GELDİ -> EKRANA RESMİ RAPORU BAS
    renderOfficialReportUI(container, reportData);
}

function renderOfficialReportUI(container, data) {
    const title = data.meeting_title || data.title || 'Toplantı Raporu';
    const code = data.meeting_code || data.code || '-';
    const duration = data.actual_duration_minutes || data.duration_minutes || 0;

    const participants = data.participants || data.participant_sessions || [];
    const notes = data.notes || data.meeting_notes || [];

    const dateStr = data.scheduled_start 
        ? new Date(data.scheduled_start).toLocaleDateString('tr-TR', { day: 'numeric', month: 'long', year: 'numeric' })
        : new Date().toLocaleDateString('tr-TR', { day: 'numeric', month: 'long', year: 'numeric' });

    container.innerHTML = `
        <div class="official-header pb-3 mb-4 d-flex justify-content-between align-items-center border-bottom">
            <div>
                <h3 class="fw-bold text-dark mb-1">💼 YEBSOFT KURUMSAL TOPLANTI RAPORU</h3>
                <span class="text-muted small">Toplantı Başlığı: <strong>${escapeHtml(title)}</strong></span>
            </div>
            <div class="text-end">
                <span class="badge bg-primary fs-6 px-3 py-2">Oda Kodu: ${escapeHtml(code)}</span>
            </div>
        </div>

        <div class="bg-light p-3 rounded mb-4 border">
            <h6 class="fw-bold text-primary mb-2 border-bottom pb-1">📋 Toplantı Detayları</h6>
            <div class="row g-3 small">
                <div class="col-md-6"><strong>Toplantı Konusu:</strong> ${escapeHtml(title)}</div>
                <div class="col-md-3"><strong>Tarih:</strong> ${dateStr}</div>
                <div class="col-md-3"><strong>Süre:</strong> <span class="text-success fw-bold">${duration} Dakika</span></div>
            </div>
        </div>

        <div class="mb-4">
            <h6 class="fw-bold text-primary mb-3 border-bottom pb-1">👥 Katılımcı Giriş / Çıkış Saatleri ve Süreler</h6>
            <div class="table-responsive">
                <table class="table table-bordered table-hover align-middle">
                    <thead class="table-dark small">
                        <tr>
                            <th>Katılımcı Ad Soyad</th>
                            <th>Kullanıcı Kodu</th>
                            <th>Giriş Saati</th>
                            <th>Çıkış Saati</th>
                            <th class="text-end">Süre</th>
                        </tr>
                    </thead>
                    <tbody class="small">
                        ${participants.length > 0 ? participants.map(p => {
                            const fullName = p.full_name || (p.first_name ? `${p.first_name || ''} ${p.last_name || ''}`.trim() : (p.email || 'Katılımcı'));
                            const joinTimeStr = p.join_time ? new Date(p.join_time).toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' }) : '-';
                            const leaveTimeStr = p.leave_time ? new Date(p.leave_time).toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' }) : 'Aktif / Çıkış Yapıldı';
                            const durMins = p.duration_minutes !== undefined ? p.duration_minutes : (p.total_seconds ? Math.round(p.total_seconds / 60) : 0);

                            return `
                                <tr>
                                    <td>
                                        <strong>${escapeHtml(fullName)}</strong>
                                        <small class="d-block text-muted" style="font-size: 0.75rem;">${escapeHtml(p.email || '')}</small>
                                    </td>
                                    <td><code>${escapeHtml(p.user_code || '-')}</code></td>
                                    <td><span class="text-success fw-bold">🟢 ${joinTimeStr}</span></td>
                                    <td><span class="text-danger fw-bold">🔴 ${leaveTimeStr}</span></td>
                                    <td class="text-end"><span class="badge bg-primary px-2 py-1">${durMins} dk</span></td>
                                </tr>
                            `;
                        }).join('') : '<tr><td colspan="5" class="text-center text-muted py-3">Toplantıda katılımcı kaydı bulunamadı.</td></tr>'}
                    </tbody>
                </table>
            </div>
        </div>

        <div class="mb-4">
            <h6 class="fw-bold text-primary mb-3 border-bottom pb-1">📝 Alınan Kararlar ve Toplantı Notları</h6>
            ${notes.length > 0 ? `
                <ul class="list-group">
                    ${notes.map(n => `
                        <li class="list-group-item p-3 border-start border-4 border-primary mb-2 rounded bg-light">
                            <div class="d-flex justify-content-between align-items-center mb-1">
                                <strong class="text-dark small">${escapeHtml(n.author_name || n.author || 'Katılımcı')}</strong>
                                <small class="text-muted">${n.created_at ? new Date(n.created_at).toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' }) : ''}</small>
                            </div>
                            <div class="text-secondary small">${escapeHtml(n.content || n.note_text || '')}</div>
                        </li>
                    `).join('')}
                </ul>
            ` : '<div class="alert alert-secondary text-center py-3 small">Bu toplantıda herhangi bir not alınmamıştır.</div>'}
        </div>

        <div class="pt-3 border-top text-muted small d-flex justify-content-between align-items-center mt-4">
            <div>© 2026 Yebsoft Toplantı Yönetim Sistemi</div>
            <div>Rapor Tarihi: ${new Date().toLocaleString('tr-TR')}</div>
        </div>
    `;
}

function escapeHtml(text) {
    if (!text) return '';
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', loadMeetingReport);
} else {
    loadMeetingReport();
}