// ============================================
// REPORT.JS - DETAYLI ZAMAN VE KATILIM RAPORU
// ============================================

async function renderFullReport(meetingId) {
    const container = document.getElementById('reportContent');
    
    try {
        const res = await fetch(`${API_BASE}/reports/meeting/${meetingId}`, {
            headers: { 'Authorization': `Bearer ${token}` }
        });

        if (!res.ok) throw new Error('Rapor çekilemedi');
        const data = await res.json();

        container.innerHTML = `
            <div class="card bg-dark text-white border-secondary mb-4">
                <div class="card-body">
                    <h3 class="card-title text-primary">${escapeHtml(data.meeting_title)}</h3>
                    <p class="text-muted">Kod: <code>${data.meeting_code}</code></p>
                    <div class="row text-center my-3">
                        <div class="col-md-4">
                            <h5>Başlangıç / Bitiş</h5>
                            <small>${new Date(data.scheduled_start).toLocaleString('tr-TR')} - ${new Date(data.scheduled_end).toLocaleString('tr-TR')}</small>
                        </div>
                        <div class="col-md-4">
                            <h5>Toplam Gerçekleşen Süre</h5>
                            <span class="badge bg-info fs-6">${data.actual_duration_minutes} Dakika</span>
                        </div>
                        <div class="col-md-4">
                            <h5>Toplam Katılımcı</h5>
                            <span class="badge bg-success fs-6">${data.total_participants_count} Kişi</span>
                        </div>
                    </div>
                </div>
            </div>

            <div class="row">
                <div class="col-md-7">
                    <div class="card bg-dark text-white border-secondary">
                        <div class="card-header border-secondary fw-bold">👥 Katılımcı Giriş/Çıkış Detayları</div>
                        <div class="card-body p-0">
                            <table class="table table-dark table-striped mb-0">
                                <thead>
                                    <tr>
                                        <th>Katılımcı</th>
                                        <th>Katılım Süresi</th>
                                        <th>Giriş / Çıkış</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    ${data.participants_summary.map(p => `
                                        <tr>
                                            <td>${escapeHtml(p.first_name + ' ' + p.last_name)}</td>
                                            <td><span class="badge bg-secondary">${p.total_active_minutes} dk</span></td>
                                            <td><small class="text-muted">${p.join_time ? new Date(p.join_time).toLocaleTimeString('tr-TR') : '-'} / ${p.leave_time ? new Date(p.leave_time).toLocaleTimeString('tr-TR') : '-'}</small></td>
                                        </tr>
                                    `).join('')}
                                </tbody>
                            </table>
                        </div>
                    </div>
                </div>

                <div class="col-md-5">
                    <div class="card bg-dark text-white border-secondary">
                        <div class="card-header border-secondary fw-bold">📝 Alınan Notlar (${data.total_notes_count})</div>
                        <ul class="list-group list-group-flush">
                            ${data.notes.map(n => `
                                <li class="list-group-item bg-dark text-white border-secondary">
                                    <small class="text-info">${escapeHtml(n.author_name)}</small>: ${escapeHtml(n.content)}
                                </li>
                            `).join('') || '<li class="list-group-item bg-dark text-muted">Not alınmadı.</li>'}
                        </ul>
                    </div>
                </div>
            </div>
        `;
    } catch (err) {
        container.innerHTML = `<div class="alert alert-danger">Rapor Yüklenemedi: ${err.message}</div>`;
    }
}