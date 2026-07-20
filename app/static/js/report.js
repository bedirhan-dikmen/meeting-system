console.log('📊 Report.js yüklendi');

const token = localStorage.getItem('token');
if (!token) {
    window.location.href = '/';
}

const API_BASE = 'http://localhost:8000/api/v1';

async function loadReport() {
    const path = window.location.pathname;
    const meetingId = path.split('/').pop();
    
    if (!meetingId || meetingId === 'report') {
        document.getElementById('reportContent').innerHTML = '<div class="alert alert-danger">Geçersiz toplantı ID</div>';
        return;
    }
    
    try {
        const res = await fetch(`${API_BASE}/reports/meeting/${meetingId}`, {
            headers: { 'Authorization': `Bearer ${token}` }
        });
        
        if (res.ok) {
            const data = await res.json();
            renderReport(data);
        } else {
            document.getElementById('reportContent').innerHTML = '<div class="alert alert-danger">Rapor alınamadı.</div>';
        }
    } catch (err) {
        console.error(err);
        document.getElementById('reportContent').innerHTML = '<div class="alert alert-danger">Bağlantı hatası!</div>';
    }
}

function renderReport(data) {
    const container = document.getElementById('reportContent');
    container.innerHTML = `
        <h4>${data.meeting_title}</h4>
        <p><strong>Kod:</strong> ${data.meeting_code}</p>
        <p><strong>Başlangıç:</strong> ${new Date(data.scheduled_start).toLocaleString('tr-TR')}</p>
        <p><strong>Süre (dk):</strong> ${data.actual_duration_minutes}</p>
        <p><strong>Katılımcı Sayısı:</strong> ${data.total_participants_count}</p>
        <hr>
        <h5>Katılımcılar</h5>
        <ul>
            ${data.participants_summary.map(p => `<li>${p.first_name} ${p.last_name} - ${p.total_active_minutes} dakika</li>`).join('')}
        </ul>
        <hr>
        <h5>Notlar (${data.total_notes_count})</h5>
        ${data.notes.length ? data.notes.map(n => `<div><strong>${n.author_name}</strong>: ${n.content} <small class="text-muted">(${new Date(n.created_at).toLocaleString('tr-TR')})</small></div>`).join('') : '<p>Not yok</p>'}
        <hr>
        <h5>Aksiyonlar (${data.total_actions_count})</h5>
        ${data.actions.length ? data.actions.map(a => `<div>${a.title} - ${a.is_completed ? '✅ Tamamlandı' : '⏳ Bekliyor'}</div>`).join('') : '<p>Aksiyon yok</p>'}
    `;
}

document.addEventListener('DOMContentLoaded', loadReport);