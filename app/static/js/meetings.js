/* ==========================================================================
   MEETINGS MODULE: 3 VIEWS (CARD, LIST, CALENDAR) & POPULATED/EMPTY STATES
   ========================================================================== */

const Meetings = {
  allMeetings: [],
  filteredMeetings: [],
  companyUsers: [],
  selectedUserIds: new Set(),
  quickSelectedUserIds: new Set(),
  currentView: 'card',    // 'card' | 'list' | 'calendar'
  currentTab: 'live',     // 'live' | 'scheduled' | 'completed' | 'cancelled'

  _hasEventListener: false,

  async init() {
    this.listenToEvents();
    await this.loadMeetings();
    this.checkUrlAction();
  },

  listenToEvents() {
    if (this._hasEventListener) return;
    this._hasEventListener = true;

    window.addEventListener('meeting:changed', () => {
      console.log("🔄 [Meetings] Canlı olay alındı, toplantı listesi güncelleniyor...");
      this.loadMeetings();
    });
  },

  checkUrlAction() {
    const params = new URLSearchParams(window.location.search);
    const action = params.get('action');
    if (action === 'create') {
      this.openCreateModal();
    } else if (action === 'quick') {
      this.openQuickMeetingModal();
    }

    // Dashboard'daki "Tümünü Gör" / "Görüntüle" bağlantıları (ör. /meetings?tab=scheduled)
    // doğrudan ilgili sekmeyi açık getirsin.
    const tab = params.get('tab');
    if (tab && ['live', 'scheduled', 'completed', 'cancelled'].includes(tab)) {
      this.switchTab(tab);
    }
  },

  /**
   * Status Normalizer: Türk karakterli ve İngilizce tüm durum değerlerini
   * 'live', 'scheduled', 'completed', 'cancelled' türlerine eşler.
   * BUG FIX: "iptal edildi" eskiden burada hiç ayrı bir kovaya düşmüyordu,
   * varsayılan olarak 'scheduled' (Planlı Toplantılar) sekmesine karışıyordu.
   */
  normalizeStatus(statusStr) {
    if (!statusStr) return 'scheduled';
    const s = String(statusStr).toLowerCase().trim();

    // Canlı / Active
    if (s === 'canli' || s === 'canlı' || s === 'active' || s === 'live' || s === 'ongoing' || s === 'başladı' || s === 'basladi') {
      return 'live';
    }

    // Tamamlandı / Bitti / Ended / Completed
    if (s === 'tamamlandi' || s === 'tamamlandı' || s === 'completed' || s === 'ended' || s === 'finished' || s === 'bitti' || s === 'kapandi' || s === 'kaptildi') {
      return 'completed';
    }

    // İptal Edildi / Cancelled
    if (s === 'iptal edildi' || s === 'iptal' || s === 'cancelled' || s === 'canceled') {
      return 'cancelled';
    }

    // Planlandı / Scheduled (Varsayılan)
    return 'scheduled';
  },

  /** Bir tarihin (ISO string / Date) bugünle aynı takvim gününe denk gelip gelmediğini döner. */
  isToday(dateStr) {
    if (!dateStr) return false;
    const d = new Date(dateStr);
    if (isNaN(d.getTime())) return false;
    const now = new Date();
    return d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth() && d.getDate() === now.getDate();
  },

  /**
   * normalizeStatus()'ün ham durumuna ek olarak, "planlı" görünen ama
   * başlaması gereken saati 1 saatten fazla geçmiş ve hiç başlamamış (actual_start
   * yok) toplantıları da otomatik olarak 'cancelled' sayar — kullanıcı katılmayı
   * unutmuş/vazgeçmiş bir toplantı sonsuza dek "Planlı Toplantılar"da asılı
   * kalmasın diye (bkz. meetings.html "İptal Edilenler" sekmesi).
   */
  getEffectiveStatus(m) {
    const norm = this.normalizeStatus(m.status);
    if (norm !== 'scheduled') return norm;

    if (m.scheduled_start && !m.actual_start) {
      const deadline = new Date(m.scheduled_start).getTime() + 60 * 60 * 1000;
      if (Date.now() > deadline) return 'cancelled';
    }
    return 'scheduled';
  },

  async loadMeetings() {
    try {
      const res = await Auth.fetchWithAuth('/api/v1/meetings/');
      if (res.ok) {
        this.allMeetings = await res.json();
      } else {
        this.allMeetings = [];
      }
    } catch (e) {
      console.warn("Toplantılar yüklenirken uyarı:", e);
      this.allMeetings = [];
    }

    this.updateTabCounts();
    this.applyTabFilter();
  },

  updateTabCounts() {
    const liveCount = this.allMeetings.filter(m => this.getEffectiveStatus(m) === 'live').length;
    const schedCount = this.allMeetings.filter(m => this.getEffectiveStatus(m) === 'scheduled').length;
    // BUG FIX: Tamamlanan/İptal Edilenler artık GÜNLÜK — rozet sayısı da
    // sekmede gerçekten listelenenle (applyTabFilter) tutarlı olsun diye
    // sadece bugüne ait olanları sayıyor.
    const compCount = this.allMeetings.filter(m => this.getEffectiveStatus(m) === 'completed' && this.isToday(m.scheduled_start)).length;
    const cancelCount = this.allMeetings.filter(m => this.getEffectiveStatus(m) === 'cancelled' && this.isToday(m.scheduled_start)).length;

    const elLive = document.getElementById('countTabLive');
    const elSched = document.getElementById('countTabScheduled');
    const elComp = document.getElementById('countTabCompleted');
    const elCancel = document.getElementById('countTabCancelled');

    if (elLive) elLive.textContent = liveCount;
    if (elSched) elSched.textContent = schedCount;
    if (elComp) elComp.textContent = compCount;
    if (elCancel) elCancel.textContent = cancelCount;
  },

  switchTab(tabName) {
    this.currentTab = tabName;

    document.querySelectorAll('.tab-filter-btn').forEach(btn => {
      btn.classList.remove('active');
      btn.style.color = '#64748b';
      btn.style.fontWeight = '600';
      btn.style.borderBottom = 'none';
    });

    const activeBtnMap = {
      live: 'tabBtnLive',
      scheduled: 'tabBtnScheduled',
      completed: 'tabBtnCompleted',
      cancelled: 'tabBtnCancelled'
    };

    const targetBtn = document.getElementById(activeBtnMap[tabName]);
    if (targetBtn) {
      targetBtn.classList.add('active');
      targetBtn.style.color = '#5b5fc7';
      targetBtn.style.fontWeight = '700';
      targetBtn.style.borderBottom = '2px solid #5b5fc7';
    }

    this.applyTabFilter();
  },

  applyTabFilter() {
    if (this.currentTab === 'live') {
      this.filteredMeetings = this.allMeetings.filter(m => this.getEffectiveStatus(m) === 'live');
    } else if (this.currentTab === 'scheduled') {
      this.filteredMeetings = this.allMeetings.filter(m => this.getEffectiveStatus(m) === 'scheduled');
    } else if (this.currentTab === 'completed') {
      // BUG FIX: Artık GÜNLÜK — tüm geçmiş "Kayıtlar" arşivinde (yöneticiler
      // için) zaten tutuluyor, burada sadece bugün tamamlananlar gösteriliyor.
      this.filteredMeetings = this.allMeetings.filter(m => this.getEffectiveStatus(m) === 'completed' && this.isToday(m.scheduled_start));
    } else if (this.currentTab === 'cancelled') {
      // YENİ: Günlük iptal edilenler — hem elle "İptal Et" ile hem de 1 saat
      // geçmiş/hiç başlamamış toplantıların otomatik düşmesiyle dolar.
      this.filteredMeetings = this.allMeetings.filter(m => this.getEffectiveStatus(m) === 'cancelled' && this.isToday(m.scheduled_start));
    } else {
      this.filteredMeetings = [...this.allMeetings];
    }

    this.renderCurrentView();
  },

  switchView(viewName) {
    // V1 NOT: Liste ve Takvim görünümleri henüz fix'lenmedi; butonlar
    // meetings.html'de `disabled` ama bu fonksiyon yine de dışarıdan
    // (konsol, eski bir onclick, vb.) çağrılabileceğinden burada da
    // engelleniyor — v2'de bu erken dönüşü kaldırmak yeterli olacak.
    if (viewName !== 'card') return;

    this.currentView = viewName;

    const cCard = document.getElementById('viewContainerCard');
    const cList = document.getElementById('viewContainerList');
    const cCal = document.getElementById('viewContainerCalendar');

    if (cCard) cCard.style.display = viewName === 'card' ? 'block' : 'none';
    if (cList) cList.style.display = viewName === 'list' ? 'block' : 'none';
    if (cCal) cCal.style.display = viewName === 'calendar' ? 'block' : 'none';

    const btnMap = {
      card: 'btnViewCard',
      list: 'btnViewList',
      calendar: 'btnViewCalendar'
    };

    ['card', 'list', 'calendar'].forEach(v => {
      const btn = document.getElementById(btnMap[v]);
      if (btn) {
        if (v === viewName) {
          btn.classList.add('active');
          btn.style.borderColor = '#5b5fc7';
          btn.style.color = '#5b5fc7';
        } else {
          btn.classList.remove('active');
          btn.style.borderColor = '#cbd5e1';
          btn.style.color = '#64748b';
        }
      }
    });

    this.renderCurrentView();
  },

  renderCurrentView() {
    if (this.currentView === 'card') {
      this.renderCardView();
    } else if (this.currentView === 'list') {
      this.renderListView();
    } else if (this.currentView === 'calendar') {
      this.renderCalendarView();
    }
  },

  /**
   * Çağıran kullanıcının bu toplantının sahibi (editörü) veya
   * admin/manager/host rolünde/superuser olup olmadığını döner. Kart ⋮
   * menüsünde Düzenle/İptal aksiyonlarının gösterilip gösterilmeyeceğine
   * (bkz. buildCardMenu) bu karar veriyor.
   */
  isMeetingOwner(m) {
    const user = (typeof Auth !== 'undefined' && Auth.getUser) ? Auth.getUser() : null;
    if (!user) return false;

    const role = String(user.role || '').toLowerCase();
    const isPrivileged = Boolean(['admin', 'manager', 'host'].includes(role) || user.is_superuser);
    if (isPrivileged) return true;

    const userId = String(user.id || user.user_id || '').toLowerCase();
    const hostId = String(m.created_by || '').toLowerCase();
    return Boolean(userId && hostId && userId === hostId);
  },

  /** ⋮ menüsünde sahip olunmayan/aksiyonsuz durumlarda gösterilen, toplantı
   * sahibinin adını bildiren salt-bilgi satırı. */
  _hostInfoMenuHtml(m) {
    return `
      <div style="padding: 0.6rem 1rem;">
        <span style="font-size: 0.68rem; font-weight: 700; color: #94a3b8; text-transform: uppercase; display: block; margin-bottom: 0.2rem;">Toplantı Sahibi</span>
        <span style="font-size: 0.85rem; font-weight: 700; color: #0f172a; display: flex; align-items: center; gap: 0.4rem;">
          <i class="far fa-user-circle" style="color: #5b5fc7;"></i> ${m.host_name || 'Bilinmiyor'}
        </span>
      </div>
    `;
  },

  /**
   * ⋮ buton + dropdown menüsünün HTML'ini üretir. dashboard.js ve
   * meetings.js'teki TÜM kart türleri (canlı/yaklaşan/liste) bu tek
   * fonksiyonu kullanır — bkz. app/routes/meetings.py enrich_meeting_active_users
   * ve app/routes/dashboard.py'nin ürettiği host_name alanı. Duruma göre içerik:
   * - Tamamlanan: HERKES için (sahip dahil) sadece toplantı sahibinin adı —
   *   tamamlanmış bir toplantı artık düzenlenemez/iptal edilemez/silinemez.
   * - İptal Edilen: sahipse sadece "Toplantıyı Sil"; değilse sahip adı.
   * - Canlı/Planlı: sahipse Düzenle + İptal Et + Sil; değilse sahip adı.
   */
  buildCardMenu(m, menuKey) {
    const isOwner = this.isMeetingOwner(m);
    const effStatus = this.getEffectiveStatus(m);

    let menuBody;
    if (effStatus === 'completed') {
      menuBody = this._hostInfoMenuHtml(m);
    } else if (effStatus === 'cancelled') {
      menuBody = isOwner ? `
        <button onclick="Meetings.deleteMeetingPermanently('${m.id}')" style="width: 100%; text-align: left; background: none; border: none; padding: 0.6rem 1rem; font-size: 0.85rem; font-weight: 600; color: #334155; cursor: pointer; display: flex; align-items: center; gap: 0.6rem;">
          <i class="far fa-trash-alt" style="color: #94a3b8;"></i> Toplantıyı Sil
        </button>
      ` : this._hostInfoMenuHtml(m);
    } else if (isOwner) {
      // Canlı / Planlı + sahip: tam menü. "İptal Et" yazısı nötr/koyu (menü
      // çok renkli görünmesin), sadece ikonu kırmızı; "Sil" ikonu gri.
      menuBody = `
        <button onclick="Meetings.openEditModal('${m.id}')" style="width: 100%; text-align: left; background: none; border: none; padding: 0.6rem 1rem; font-size: 0.85rem; font-weight: 600; color: #334155; cursor: pointer; display: flex; align-items: center; gap: 0.6rem;">
          <i class="far fa-edit" style="color: #6366f1;"></i> Toplantı Bilgilerini Düzenle
        </button>
        <button onclick="Meetings.cancelMeeting('${m.id}')" style="width: 100%; text-align: left; background: none; border: none; padding: 0.6rem 1rem; font-size: 0.85rem; font-weight: 600; color: #334155; cursor: pointer; display: flex; align-items: center; gap: 0.6rem; border-top: 1px solid #f1f5f9;">
          <i class="far fa-times-circle" style="color: #ef4444;"></i> Toplantıyı İptal Et
        </button>
        <button onclick="Meetings.deleteMeetingPermanently('${m.id}')" style="width: 100%; text-align: left; background: none; border: none; padding: 0.6rem 1rem; font-size: 0.85rem; font-weight: 600; color: #334155; cursor: pointer; display: flex; align-items: center; gap: 0.6rem; border-top: 1px solid #f1f5f9;">
          <i class="far fa-trash-alt" style="color: #94a3b8;"></i> Toplantıyı Sil
        </button>
      `;
    } else {
      menuBody = this._hostInfoMenuHtml(m);
    }

    return `
      <div style="position: relative;">
        <button onclick="Meetings.toggleCardMenu(event, '${menuKey}')" style="background: none; border: none; font-size: 1rem; color: #94a3b8; cursor: pointer; padding: 0.2rem 0.4rem; border-radius: 6px;" title="Seçenekler">&#8942;</button>
        <div id="cardMenu_${menuKey}" class="card-dropdown-menu" style="display: none; position: absolute; top: 100%; right: 0; background: #ffffff; border: 1px solid #e2e8f0; border-radius: 10px; box-shadow: 0 10px 25px rgba(0,0,0,0.12); width: min(210px, calc(100vw - 2.5rem)); max-width: 210px; z-index: 1000; padding: 0.4rem 0;">
          ${menuBody}
        </div>
      </div>
    `;
  },

  /**
   * "Odaya Katıl" tıklamalarının tümü buradan geçer: toplantı akışı
   * (prejoin → room) artık YENİ bir sekmede açılıyor. Böylece ana panel
   * sekmesinin tarayıcı geçmişi hiç toplantı odasıyla karışmıyor — geri/ileri
   * tuşuyla eski/sona ermiş bir toplantı odasına yanlışlıkla dönme riski
   * (ve bunun getirdiği not/rapor düzenleme bug'ı) kökten kalkıyor.
   */
  openMeetingInNewTab(meetingCode) {
    window.open(`/prejoin/${meetingCode}`, '_blank', 'noopener');
  },

  /** Resmi toplantı raporunu (salt okunur) ayrı/yeni bir sekmede açar. */
  openReportInNewTab(meetingId) {
    window.open(`/reports/${meetingId}`, '_blank', 'noopener');
  },

  /* --------------------------------------------------------------------------
     1. KART GÖRÜNÜMÜ RENDERER
     -------------------------------------------------------------------------- */
  renderCardView() {
    const container = document.getElementById('viewContainerCard');
    if (!container) return;

    if (this.filteredMeetings && this.filteredMeetings.length > 0) {
      container.innerHTML = `
        <div style="display: grid; grid-template-columns: repeat(auto-fill, minmax(280px, 1fr)); gap: 1.25rem;">
          ${this.filteredMeetings.map(m => {
            // BUG FIX: Ham status yerine getEffectiveStatus() kullanılıyor —
            // 1 saat geçmiş/hiç başlamamış planlı toplantılar da artık burada
            // "iptal edildi" gibi ele alınıyor (bkz. getEffectiveStatus).
            const effStatus = this.getEffectiveStatus(m);
            const isLive = effStatus === 'live';
            const isCompleted = effStatus === 'completed';
            const isCancelled = effStatus === 'cancelled';
            const isFinished = isCompleted || isCancelled;

            let badgeBg = '#eff6ff';
            let badgeColor = '#1d4ed8';
            let badgeText = m.time_str || 'Planlandı';

            if (isLive) {
              badgeBg = '#dcfce7';
              badgeColor = '#166534';
              badgeText = '<span style="width:6px; height:6px; border-radius:50%; background:#166534;"></span> CANLI';
            } else if (isCompleted) {
              badgeBg = '#f1f5f9';
              badgeColor = '#64748b';
              badgeText = 'TAMAMLANDI ✓';
            } else if (isCancelled) {
              badgeBg = '#ffe4e6';
              badgeColor = '#be123c';
              badgeText = 'İPTAL EDİLDİ';
            }

            // BUG FIX: Tamamlanan/İptal Edilen kartlarında "odadaki anlık
            // katılımcı" bilgisi artık hiç gösterilmiyor — toplantı zaten
            // bitmiş/hiç başlamamış, bu bilgi anlamsız.
            let avatarsHtml = '';
            if (!isFinished) {
              const parts = m.participants || m.active_participants || [];
              const maxAvatars = 5;
              const visibleParts = parts.slice(0, maxAvatars);
              const extraCount = parts.length > maxAvatars ? parts.length - maxAvatars : 0;

              if (parts.length > 0) {
                avatarsHtml = `
                  <div style="display: flex; align-items: center; margin-top: 0.85rem; margin-bottom: 1.1rem;">
                    <div style="display: flex;">
                      ${visibleParts.map((p, idx) => `
                        <div title="${p.name || ''}" style="width: 28px; height: 28px; border-radius: 50%; background: #e0e7ff; color: #4338ca; border: 2px solid #ffffff; display: flex; align-items: center; justify-content: center; font-size: 0.72rem; font-weight: 800; margin-left: ${idx === 0 ? '0' : '-8px'}; box-shadow: 0 2px 4px rgba(0,0,0,0.05);">
                          ${p.avatar ? `<img src="${p.avatar}" style="width:100%; height:100%; border-radius:50%; object-fit:cover;">` : (p.initials || 'U')}
                        </div>
                      `).join('')}
                    </div>
                    ${extraCount > 0 ? `
                      <span style="font-size: 0.72rem; font-weight: 700; color: #64748b; background: #f1f5f9; padding: 0.15rem 0.45rem; border-radius: 10px; margin-left: 4px;">+${extraCount}</span>
                    ` : ''}
                  </div>
                `;
              } else {
                avatarsHtml = `
                  <div style="display: flex; align-items: center; margin-top: 0.85rem; margin-bottom: 1.1rem; font-size: 0.76rem; color: #94a3b8; font-weight: 500; gap: 0.35rem;">
                    <i class="far fa-user-circle" style="color: #cbd5e1; font-size: 0.85rem;"></i> Odada henüz katılım yok
                  </div>
                `;
              }
            }

            // BUG FIX: Tamamlanan/İptal Edilende "Odaya Katıl" ve "Detaylar"
            // artık yok. Tamamlananda tek buton "Raporu Görüntüle" (yeni
            // sekmede açılır); iptal edilende raporda olmadığından hiç buton
            // gösterilmiyor.
            let actionsHtml = '';
            if (isCompleted) {
              actionsHtml = `
                <div style="display: flex; gap: 0.5rem; align-items: center;">
                  <button onclick="Meetings.openReportInNewTab('${m.id}')" style="background: #5b5fc7; color: #ffffff; border: none; border-radius: 8px; padding: 0.55rem 1rem; font-weight: 700; font-size: 0.82rem; cursor: pointer; flex: 1; transition: all 0.2s;">
                    <i class="fas fa-file-contract"></i> Raporu Görüntüle
                  </button>
                </div>
              `;
            } else if (!isCancelled) {
              actionsHtml = `
                <div style="display: flex; gap: 0.5rem; align-items: center;">
                  <button onclick="Meetings.openMeetingInNewTab('${m.meeting_code}')" style="background: #5b5fc7; color: #ffffff; border: none; border-radius: 8px; padding: 0.55rem 1rem; font-weight: 700; font-size: 0.82rem; cursor: pointer; flex: 1; transition: all 0.2s;">
                    Odaya Katıl
                  </button>
                  <button onclick="Meetings.openDetailsModal('${m.id}')" style="background: #ffffff; color: #475569; border: 1px solid #cbd5e1; border-radius: 8px; padding: 0.55rem 1rem; font-weight: 700; font-size: 0.82rem; cursor: pointer; flex: 1; transition: all 0.2s;">
                    Detaylar
                  </button>
                </div>
              `;
            }

            return `
              <div style="background: #ffffff; border: 1px solid #e2e8f0; border-radius: 16px; padding: 1.25rem; box-shadow: 0 4px 20px rgba(15, 23, 42, 0.03); display: flex; flex-direction: column; justify-content: space-between;">
                <div>
                  <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 0.85rem;">
                    <span style="background: ${badgeBg}; color: ${badgeColor}; font-size: 0.7rem; font-weight: 800; padding: 0.2rem 0.55rem; border-radius: 6px; display: flex; align-items: center; gap: 0.35rem;">
                      ${badgeText}
                    </span>
                    ${this.buildCardMenu(m, `popMenu_${m.id}`)}
                  </div>

                  <div style="display: flex; align-items: center; gap: 0.75rem; margin-bottom: 0.75rem;">
                    <div style="width: 44px; height: 44px; border-radius: 12px; background: ${isLive ? '#eeefec' : (isCancelled ? '#ffe4e6' : '#f8fafc')}; color: ${isCancelled ? '#be123c' : '#5b5fc7'}; display: flex; align-items: center; justify-content: center; font-size: 1.25rem; flex-shrink: 0;">
                      <i class="${isLive ? 'fas fa-video' : (isCompleted ? 'fas fa-check-circle' : (isCancelled ? 'fas fa-ban' : 'far fa-calendar-alt'))}"></i>
                    </div>
                    <div>
                      <span style="font-size: 0.75rem; color: #64748b;">${m.time_str || 'Planlı Oturum'}</span>
                      <h4 style="font-size: 0.95rem; font-weight: 800; color: #0f172a; margin-top: 0.1rem;">${m.title}</h4>
                      <span style="font-size: 0.75rem; color: #94a3b8;"><i class="fas fa-tag"></i> ${m.meeting_type || 'Planlı Toplantı'}</span>
                    </div>
                  </div>

                  ${avatarsHtml}
                </div>

                ${actionsHtml}
              </div>
            `;
          }).join('')}
        </div>
      `;
    } else {
      const tabTitleMap = {
        live: 'Aktif canlı toplantınız yok',
        scheduled: 'Planlanmış toplantınız yok',
        completed: 'Bugün tamamlanmış toplantınız yok',
        cancelled: 'Bugün iptal edilmiş toplantınız yok',
        all: 'Kayıtlı toplantı bulunmuyor'
      };

      container.innerHTML = `
        <div style="background: #ffffff; border: 1px solid #e2e8f0; border-radius: 16px; padding: 3.5rem 2rem; text-align: center; display: flex; flex-direction: column; align-items: center; justify-content: center; box-shadow: 0 4px 20px rgba(15, 23, 42, 0.03);">
          <div style="width: 120px; height: 90px; margin-bottom: 1.25rem; display: flex; align-items: center; justify-content: center;">
            <svg viewBox="0 0 120 90" fill="none" xmlns="http://www.w3.org/2000/svg" style="width: 100%; height: auto;">
              <circle cx="60" cy="45" r="35" fill="#EEF2FF"/>
              <rect x="42" y="32" width="36" height="26" rx="6" fill="#5B5FC7"/>
              <path d="M78 40L88 34V56L78 50V40Z" fill="#5B5FC7"/>
            </svg>
          </div>
          <h3 style="font-size: 1.2rem; font-weight: 800; color: #0f172a; margin-bottom: 0.4rem;">${tabTitleMap[this.currentTab] || 'Toplantı bulunmuyor'}</h3>
          <p style="color: #64748b; font-size: 0.88rem; max-width: 420px; margin-bottom: 1.5rem; line-height: 1.4;">Bu kategoride henüz kayıtlı bir toplantı bulunmuyor. Hemen yeni bir toplantı başlatabilir veya planlayabilirsiniz.</p>
          <div style="display: flex; gap: 0.85rem;">
            <button onclick="Meetings.openQuickMeetingModal()" style="background: #5b5fc7; color: #ffffff; border: none; border-radius: 10px; padding: 0.7rem 1.5rem; font-weight: 700; font-size: 0.9rem; cursor: pointer; display: inline-flex; align-items: center; gap: 0.4rem;">
              <i class="fas fa-bolt"></i> Hızlı Toplantı Başlat
            </button>
            <button onclick="Meetings.openCreateModal()" style="background: #ffffff; color: #475569; border: 1px solid #cbd5e1; border-radius: 10px; padding: 0.7rem 1.4rem; font-weight: 700; font-size: 0.9rem; cursor: pointer; display: inline-flex; align-items: center; gap: 0.4rem;">
              <i class="far fa-calendar-plus"></i> Toplantı Planla
            </button>
          </div>
        </div>
      `;
    }
  },

  /* --------------------------------------------------------------------------
     2. LİSTE GÖRÜNÜMÜ RENDERER
     -------------------------------------------------------------------------- */
  renderListView() {
    const container = document.getElementById('viewContainerList');
    if (!container) return;

    let html = `
      <div style="background: #ffffff; border: 1px solid #e2e8f0; border-radius: 16px; padding: 1.25rem; box-shadow: 0 4px 20px rgba(15, 23, 42, 0.03);">
        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 1.25rem; flex-wrap: wrap; gap: 0.85rem;">
          <div style="display: flex; align-items: center; background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 10px; padding: 0.45rem 0.85rem; width: 280px;">
            <i class="fas fa-search" style="color: #94a3b8; font-size: 0.85rem; margin-right: 0.5rem;"></i>
            <input type="text" id="listSearchInput" placeholder="Toplantı ara..." style="background: transparent; border: none; outline: none; font-size: 0.85rem; width: 100%; color: #0f172a;">
          </div>

          <button style="background: #ffffff; color: #475569; border: 1px solid #cbd5e1; border-radius: 10px; padding: 0.45rem 1rem; font-weight: 700; font-size: 0.85rem; cursor: pointer; display: inline-flex; align-items: center; gap: 0.4rem;">
            <i class="fas fa-sliders-h" style="color: #5b5fc7;"></i> Filtreler <i class="fas fa-chevron-down" style="font-size: 0.7rem;"></i>
          </button>
        </div>
    `;

    if (this.filteredMeetings && this.filteredMeetings.length > 0) {
      html += `
        <div style="overflow-x: auto;">
          <table style="width: 100%; border-collapse: collapse; text-align: left; font-size: 0.88rem;">
            <thead>
              <tr style="border-bottom: 1px solid #e2e8f0; color: #64748b; font-size: 0.78rem; font-weight: 700; text-transform: uppercase;">
                <th style="padding: 0.75rem 1rem;">Toplantı Adı</th>
                <th style="padding: 0.75rem 1rem;">Tarih & Saat</th>
                <th style="padding: 0.75rem 1rem;">Tür</th>
                <th style="padding: 0.75rem 1rem;">Katılımcılar</th>
                <th style="padding: 0.75rem 1rem;">Durum</th>
                <th style="padding: 0.75rem 1rem; text-align: right;">İşlemler</th>
              </tr>
            </thead>
            <tbody>
              ${this.filteredMeetings.map(m => {
                const normStatus = this.normalizeStatus(m.status);
                const isLive = normStatus === 'live';
                const isCompleted = normStatus === 'completed';

                let statusBadge = `<span style="background: #eff6ff; color: #1d4ed8; font-size: 0.72rem; font-weight: 800; padding: 0.2rem 0.55rem; border-radius: 6px;">Planlandı</span>`;
                if (isLive) {
                  statusBadge = `<span style="background: #dcfce7; color: #166534; font-size: 0.72rem; font-weight: 800; padding: 0.2rem 0.55rem; border-radius: 6px;">CANLI</span>`;
                } else if (isCompleted) {
                  statusBadge = `<span style="background: #f1f5f9; color: #64748b; font-size: 0.72rem; font-weight: 800; padding: 0.2rem 0.55rem; border-radius: 6px;">Tamamlandı</span>`;
                }

                return `
                  <tr style="border-bottom: 1px solid #f1f5f9; transition: background 0.15s;">
                    <td style="padding: 0.85rem 1rem; font-weight: 700; color: #0f172a; display: flex; align-items: center; gap: 0.5rem;">
                      <span style="width: 8px; height: 8px; border-radius: 50%; background: ${isLive ? '#10b981' : (isCompleted ? '#94a3b8' : '#5b5fc7')};"></span>
                      ${m.title}
                    </td>
                    <td style="padding: 0.85rem 1rem; color: #64748b;">${m.time_str || 'Bugün 14:30 - 15:30'}</td>
                    <td style="padding: 0.85rem 1rem;">
                      <span style="background: #eeefec; color: #5b5fc7; font-size: 0.72rem; font-weight: 700; padding: 0.2rem 0.55rem; border-radius: 6px;">${m.meeting_type || 'Planlı Toplantı'}</span>
                    </td>
                    <td style="padding: 0.85rem 1rem;">
                      <div style="display: flex; align-items: center; gap: 0.25rem;">
                        <img src="https://images.unsplash.com/photo-1534528741775-53994a69daeb?auto=format&fit=crop&w=80&q=80" style="width: 24px; height: 24px; border-radius: 50%;">
                        <img src="https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?auto=format&fit=crop&w=80&q=80" style="width: 24px; height: 24px; border-radius: 50%;">
                        <span style="font-size: 0.72rem; font-weight: 700; color: #64748b;">+5</span>
                      </div>
                    </td>
                    <td style="padding: 0.85rem 1rem;">
                      ${statusBadge}
                    </td>
                    <td style="padding: 0.85rem 1rem; text-align: right;">
                      <button onclick="Meetings.openMeetingInNewTab('${m.meeting_code}')" style="background: ${isLive ? '#5b5fc7' : '#f1f5f9'}; color: ${isLive ? '#ffffff' : '#4f46e5'}; border: none; border-radius: 6px; padding: 0.4rem 0.85rem; font-weight: 700; font-size: 0.78rem; cursor: pointer; margin-right: 0.35rem;">
                        ${isLive ? 'Katıl' : 'Detaylar'}
                      </button>
                      <button onclick="Meetings.showMeetingInfo('${m.id}')" style="background: none; border: none; color: #94a3b8; font-size: 0.9rem; cursor: pointer;">⋮</button>
                    </td>
                  </tr>
                `;
              }).join('')}
            </tbody>
          </table>
        </div>
      `;
    } else {
      const tabTitleMap = {
        live: 'Canlı toplantınız yok',
        scheduled: 'Planlanmış toplantınız yok',
        completed: 'Tamamlanmış toplantınız yok',
        all: 'Kayıtlı toplantı bulunmuyor'
      };

      html += `
        <div style="padding: 3.5rem 1.5rem; text-align: center; display: flex; flex-direction: column; align-items: center; justify-content: center;">
          <div style="width: 110px; height: 80px; margin-bottom: 1.25rem; display: flex; align-items: center; justify-content: center;">
            <svg viewBox="0 0 100 80" fill="none" xmlns="http://www.w3.org/2000/svg" style="width: 100%; height: auto;">
              <rect x="15" y="20" width="70" height="50" rx="10" fill="#EEF2FF" stroke="#6366F1" stroke-width="2"/>
              <rect x="15" y="20" width="70" height="15" rx="10" fill="#6366F1"/>
              <circle cx="35" cy="15" r="3" fill="#6366F1"/>
              <circle cx="65" cy="15" r="3" fill="#6366F1"/>
            </svg>
          </div>
          <h3 style="font-size: 1.15rem; font-weight: 800; color: #0f172a; margin-bottom: 0.4rem;">${tabTitleMap[this.currentTab] || 'Toplantı yok'}</h3>
          <p style="color: #64748b; font-size: 0.88rem; max-width: 420px; margin-bottom: 1.5rem; line-height: 1.4;">Bu kategoride henüz toplantı bulunmuyor. Yeni bir toplantı planlayabilirsiniz.</p>
          <div style="display: flex; gap: 0.85rem;">
            <button onclick="Meetings.openCreateModal()" style="background: #5b5fc7; color: #ffffff; border: none; border-radius: 10px; padding: 0.7rem 1.5rem; font-weight: 700; font-size: 0.9rem; cursor: pointer; display: inline-flex; align-items: center; gap: 0.4rem;">
              <i class="far fa-calendar-plus"></i> Toplantı Planla
            </button>
            <button onclick="Meetings.openQuickMeetingModal()" style="background: #ffffff; color: #475569; border: 1px solid #cbd5e1; border-radius: 10px; padding: 0.7rem 1.4rem; font-weight: 700; font-size: 0.9rem; cursor: pointer; display: inline-flex; align-items: center; gap: 0.4rem;">
              <i class="fas fa-bolt"></i> Hızlı Toplantı
            </button>
          </div>
        </div>
      `;
    }

    html += `</div>`;
    container.innerHTML = html;
  },

  /* --------------------------------------------------------------------------
     3. TAKVİM GÖRÜNÜMÜ RENDERER
     -------------------------------------------------------------------------- */
  renderCalendarView() {
    const container = document.getElementById('viewContainerCalendar');
    if (!container) return;

    if (this.filteredMeetings && this.filteredMeetings.length > 0) {
      container.innerHTML = `
        <div style="display: grid; grid-template-columns: 240px 1fr; gap: 1.5rem;">
          <div style="background: #ffffff; border: 1px solid #e2e8f0; border-radius: 16px; padding: 1.25rem; box-shadow: 0 4px 20px rgba(15, 23, 42, 0.03);">
            <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 1rem;">
              <h4 style="font-size: 0.95rem; font-weight: 800; color: #0f172a;">Mayıs 2024</h4>
              <div style="display: flex; gap: 0.25rem;">
                <button style="background: none; border: none; color: #64748b; cursor: pointer;">&lt;</button>
                <button style="background: none; border: none; color: #64748b; cursor: pointer;">&gt;</button>
              </div>
            </div>

            <div style="display: grid; grid-template-columns: repeat(7, 1fr); text-align: center; gap: 0.35rem; font-size: 0.72rem;">
              <span style="font-weight: 700; color: #94a3b8;">Pzt</span>
              <span style="font-weight: 700; color: #94a3b8;">Sal</span>
              <span style="font-weight: 700; color: #94a3b8;">Çar</span>
              <span style="font-weight: 700; color: #94a3b8;">Per</span>
              <span style="font-weight: 700; color: #94a3b8;">Cum</span>
              <span style="font-weight: 700; color: #94a3b8;">Cmt</span>
              <span style="font-weight: 700; color: #94a3b8;">Paz</span>

              ${[...Array(31)].map((_, i) => `
                <span style="padding: 0.3rem 0; border-radius: 50%; ${i + 1 === 3 ? 'background:#5b5fc7; color:#fff; font-weight:800;' : 'color:#475569;'}">${i + 1}</span>
              `).join('')}
            </div>

            <button style="background: #f8fafc; color: #5b5fc7; border: 1px solid #e2e8f0; border-radius: 8px; padding: 0.5rem; width: 100%; font-weight: 700; font-size: 0.8rem; cursor: pointer; margin-top: 1.25rem;">
              Bugüne Dön
            </button>
          </div>

          <div style="background: #ffffff; border: 1px solid #e2e8f0; border-radius: 16px; padding: 1.25rem; box-shadow: 0 4px 20px rgba(15, 23, 42, 0.03);">
            <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 1.25rem;">
              <div style="display: flex; align-items: center; gap: 0.75rem;">
                <button style="background: #f8fafc; border: 1px solid #cbd5e1; border-radius: 6px; padding: 0.35rem 0.65rem; font-size: 0.8rem;">&lt;</button>
                <button style="background: #f8fafc; border: 1px solid #cbd5e1; border-radius: 6px; padding: 0.35rem 0.65rem; font-size: 0.8rem;">&gt;</button>
                <h4 style="font-size: 1rem; font-weight: 800; color: #0f172a; margin: 0;">1 - 7 Mayıs 2024</h4>
              </div>

              <div style="display: flex; gap: 0.35rem;">
                <button style="background: #ffffff; border: 1px solid #cbd5e1; border-radius: 6px; padding: 0.35rem 0.75rem; font-size: 0.8rem; font-weight: 600; color: #64748b;">Gün</button>
                <button style="background: #5b5fc7; border: none; border-radius: 6px; padding: 0.35rem 0.75rem; font-size: 0.8rem; font-weight: 800; color: #ffffff;">Hafta</button>
                <button style="background: #ffffff; border: 1px solid #cbd5e1; border-radius: 6px; padding: 0.35rem 0.75rem; font-size: 0.8rem; font-weight: 600; color: #64748b;">Ay</button>
              </div>
            </div>

            <div style="display: grid; grid-template-columns: repeat(7, 1fr); text-align: center; border-bottom: 1px solid #e2e8f0; padding-bottom: 0.5rem; font-size: 0.78rem; font-weight: 700; color: #475569;">
              <div>Pzt 1 May</div>
              <div>Sal 2 May</div>
              <div style="color:#5b5fc7;">Çar 3 May</div>
              <div>Per 4 May</div>
              <div style="color:#10b981;">Cum 5 May</div>
              <div>Cmt 6 May</div>
              <div>Paz 7 May</div>
            </div>

            <div style="display: grid; grid-template-columns: repeat(7, 1fr); gap: 0.5rem; min-height: 260px; padding-top: 1rem;">
              <div></div>
              <div></div>
              
              <div style="display: flex; flex-direction: column; gap: 0.5rem;">
                <div style="background: #eeefec; border-left: 3px solid #5b5fc7; border-radius: 6px; padding: 0.5rem; font-size: 0.72rem;">
                  <span style="font-weight: 700; color: #5b5fc7; display: block;">10:00 - 11:00</span>
                  <strong style="color: #0f172a;">Sprint Planlama</strong>
                </div>
              </div>

              <div></div>

              <div style="display: flex; flex-direction: column; gap: 0.5rem;">
                <div style="background: #dcfce7; border-left: 3px solid #10b981; border-radius: 6px; padding: 0.5rem; font-size: 0.72rem;">
                  <span style="font-weight: 800; color: #166534; display: block;">14:30 - 15:30 [CANLI]</span>
                  <strong style="color: #0f172a;">Proje Değerlendirme</strong>
                </div>
              </div>

              <div></div>
              <div></div>
            </div>

          </div>
        </div>
      `;
    } else {
      container.innerHTML = `
        <div style="background: #ffffff; border: 1px solid #e2e8f0; border-radius: 16px; padding: 1.25rem; box-shadow: 0 4px 20px rgba(15, 23, 42, 0.03); min-height: 420px; position: relative;">
          <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 1.25rem; border-bottom: 1px solid #f1f5f9; padding-bottom: 0.85rem;">
            <div style="display: flex; align-items: center; gap: 0.75rem;">
              <button style="background: #f8fafc; border: 1px solid #cbd5e1; border-radius: 6px; padding: 0.35rem 0.65rem; font-size: 0.8rem; cursor: pointer;">&lt;</button>
              <button style="background: #f8fafc; border: 1px solid #cbd5e1; border-radius: 6px; padding: 0.35rem 0.65rem; font-size: 0.8rem; cursor: pointer;">&gt;</button>
              <button style="background: #ffffff; border: 1px solid #cbd5e1; border-radius: 6px; padding: 0.35rem 0.75rem; font-size: 0.8rem; font-weight: 700; color: #475569; cursor: pointer;">Bugün</button>
              <h4 style="font-size: 1rem; font-weight: 800; color: #0f172a; margin: 0; margin-left: 0.5rem;">27 Mayıs - 2 Haziran 2024</h4>
            </div>

            <div style="display: flex; gap: 0.35rem;">
              <button style="background: #ffffff; border: 1px solid #cbd5e1; border-radius: 6px; padding: 0.35rem 0.75rem; font-size: 0.8rem; font-weight: 600; color: #64748b; cursor: pointer;">Gün</button>
              <button style="background: #5b5fc7; border: none; border-radius: 6px; padding: 0.35rem 0.75rem; font-size: 0.8rem; font-weight: 800; color: #ffffff; cursor: pointer;">Hafta</button>
              <button style="background: #ffffff; border: 1px solid #cbd5e1; border-radius: 6px; padding: 0.35rem 0.75rem; font-size: 0.8rem; font-weight: 600; color: #64748b; cursor: pointer;">Ay</button>
            </div>
          </div>

          <div style="display: grid; grid-template-columns: repeat(7, 1fr); text-align: center; border-bottom: 1px solid #e2e8f0; padding-bottom: 0.5rem; font-size: 0.78rem; font-weight: 700; color: #64748b;">
            <div>Pzt 27 Mayıs</div>
            <div>Sal 28 Mayıs</div>
            <div>Çar 29 Mayıs</div>
            <div>Per 30 Mayıs</div>
            <div>Cum 31 Mayıs</div>
            <div>Cmt 1 Haziran</div>
            <div>Paz 2 Haziran</div>
          </div>

          <div style="padding: 4rem 1.5rem; text-align: center; display: flex; flex-direction: column; align-items: center; justify-content: center;">
            <div style="width: 120px; height: 90px; margin-bottom: 1.25rem; display: flex; align-items: center; justify-content: center;">
              <svg viewBox="0 0 160 120" fill="none" xmlns="http://www.w3.org/2000/svg" style="width: 100%; height: auto;">
                <rect x="30" y="50" width="100" height="55" rx="10" fill="#5B5FC7" fill-opacity="0.15" stroke="#5B5FC7" stroke-width="2"/>
                <path d="M30 50L80 25L130 50" stroke="#5B5FC7" stroke-width="2"/>
                <circle cx="50" cy="35" r="6" fill="#F59E0B"/>
                <circle cx="80" cy="20" r="5" fill="#10B981"/>
                <circle cx="110" cy="38" r="7" fill="#EF4444"/>
              </svg>
            </div>
            <h3 style="font-size: 1.15rem; font-weight: 800; color: #0f172a; margin-bottom: 0.4rem;">Bu hafta için planlanmış toplantı yok</h3>
            <p style="color: #64748b; font-size: 0.88rem; max-width: 420px; margin-bottom: 1.5rem; line-height: 1.4;">Takviminiz boş görünüyor. Yeni bir toplantı planlayarak gününüzü organize edin.</p>
            <button onclick="Meetings.openCreateModal()" style="background: #5b5fc7; color: #ffffff; border: none; border-radius: 10px; padding: 0.7rem 1.6rem; font-weight: 700; font-size: 0.9rem; cursor: pointer; display: inline-flex; align-items: center; gap: 0.4rem; box-shadow: 0 4px 12px rgba(91, 95, 199, 0.25);">
              <i class="far fa-calendar-plus"></i> Toplantı Planla
            </button>
          </div>
        </div>
      `;
    }
  },

  /* --------------------------------------------------------------------------
     MODAL & PASSCODE & PARTICIPANT HANDLERS
     -------------------------------------------------------------------------- */
  generateRandomPasscode(targetId = 'createPasscode') {
    const randomCode = Math.floor(10000 + Math.random() * 90000);
    const passcodeEl = document.getElementById(targetId);
    if (passcodeEl) passcodeEl.value = randomCode;
  },

  async loadCompanyUsers() {
    try {
      const res = await Auth.fetchWithAuth('/api/v1/users/');
      if (res.ok) {
        const users = await res.json();
        const currentUser = (typeof Auth !== 'undefined' && Auth.getUser) ? Auth.getUser() : null;
        const currentUserId = String(currentUser?.id || currentUser?.user_id || '').toLowerCase();
        const currentUserEmail = String(currentUser?.email || '').toLowerCase();

        // Kendi kendini davet etmeyi engellemek için oturum açan kullanıcıyı listeden çıkarıyoruz
        this.companyUsers = (users || []).filter(u => {
          const uId = String(u.id || '').toLowerCase();
          const uEmail = String(u.email || '').toLowerCase();
          if (currentUserId && uId === currentUserId) return false;
          if (currentUserEmail && uEmail === currentUserEmail) return false;
          return true;
        });
      } else {
        this.companyUsers = [];
      }
    } catch (e) {
      console.warn("Kullanıcılar yüklenirken uyarı:", e);
      this.companyUsers = [];
    }
    this.renderUsersListContainer();
    this.renderQuickUsersListContainer();
  },

  renderUsersListContainer(filterText = '') {
    const container = document.getElementById('usersListContainer');
    if (!container) return;

    const text = (filterText || '').toLowerCase().trim();
    const filtered = this.companyUsers.filter(u => {
      const name = `${u.first_name || ''} ${u.last_name || ''}`.toLowerCase();
      const email = (u.email || '').toLowerCase();
      return name.includes(text) || email.includes(text);
    });

    if (filtered.length === 0) {
      container.innerHTML = `<span style="font-size: 0.78rem; color: #94a3b8; text-align: center; padding: 0.5rem;">Kullanıcı bulunamadı</span>`;
      return;
    }

    container.innerHTML = filtered.map(u => {
      const isChecked = this.selectedUserIds.has(u.id);
      const fullName = `${u.first_name || ''} ${u.last_name || ''}`.trim() || u.email;
      return `
        <label style="display: flex; align-items: center; gap: 0.5rem; font-size: 0.82rem; color: #0f172a; padding: 0.25rem 0.4rem; border-radius: 6px; cursor: pointer; transition: background 0.15s; ${isChecked ? 'background: #eff6ff;' : ''}">
          <input type="checkbox" value="${u.id}" ${isChecked ? 'checked' : ''} onchange="Meetings.toggleUserSelection('${u.id}')" style="accent-color: #5b5fc7; width: 15px; height: 15px;">
          <span style="font-weight: 700;">${fullName}</span>
          <span style="font-size: 0.74rem; color: #64748b; margin-left: auto;">(${u.email})</span>
        </label>
      `;
    }).join('');
  },

  filterParticipantList(query) {
    this.renderUsersListContainer(query);
  },

  toggleUserSelection(userId) {
    if (this.selectedUserIds.has(userId)) {
      this.selectedUserIds.delete(userId);
    } else {
      this.selectedUserIds.add(userId);
    }
    this.renderSelectedChips();
    this.renderUsersListContainer(document.getElementById('participantSearchInput')?.value || '');
  },

  toggleSelectAllParticipants(forceAll = false) {
    const btn = document.getElementById('btnCreateSelectAll');
    if (forceAll || this.selectedUserIds.size < this.companyUsers.length) {
      this.companyUsers.forEach(u => this.selectedUserIds.add(u.id));
      if (btn) {
        btn.style.background = '#5b5fc7';
        btn.style.color = '#ffffff';
        btn.innerHTML = `<i class="fas fa-undo"></i> Seçimi Sıfırla`;
      }
    } else {
      this.selectedUserIds.clear();
      if (btn) {
        btn.style.background = '#f1f5f9';
        btn.style.color = '#5b5fc7';
        btn.innerHTML = `<i class="fas fa-check-double"></i> Herkesi Davet Et`;
      }
    }
    this.renderSelectedChips();
    this.renderUsersListContainer(document.getElementById('participantSearchInput')?.value || '');
  },

  renderSelectedChips() {
    const badge = document.getElementById('participantCountBadge');
    if (badge) {
      const count = this.selectedUserIds.size;
      badge.textContent = count > 0 ? `(${count} kişi seçildi)` : '(İsteğe bağlı)';
      badge.style.color = count > 0 ? '#5b5fc7' : '#64748b';
    }

    const container = document.getElementById('selectedParticipantsContainer');
    if (!container) return;

    if (this.selectedUserIds.size === 0) {
      container.innerHTML = '';
      return;
    }

    const selectedUsers = this.companyUsers.filter(u => this.selectedUserIds.has(u.id));
    container.innerHTML = selectedUsers.map(u => {
      const fullName = `${u.first_name || ''} ${u.last_name || ''}`.trim() || u.email;
      return `
        <span style="background: #eeefec; color: #5b5fc7; font-size: 0.75rem; font-weight: 700; padding: 0.2rem 0.55rem; border-radius: 12px; display: inline-flex; align-items: center; gap: 0.35rem; border: 1px solid #c7d2fe;">
          ${fullName}
          <button type="button" onclick="Meetings.toggleUserSelection('${u.id}')" style="background: none; border: none; color: #5b5fc7; cursor: pointer; font-size: 0.85rem; padding: 0; line-height: 1;">&times;</button>
        </span>
      `;
    }).join('');
  },

  /* HIZLI TOPLANTI PARTICIPANTS HANDLERS */
  renderQuickUsersListContainer(filterText = '') {
    const container = document.getElementById('quickUsersListContainer');
    if (!container) return;

    const text = (filterText || '').toLowerCase().trim();
    const filtered = this.companyUsers.filter(u => {
      const name = `${u.first_name || ''} ${u.last_name || ''}`.toLowerCase();
      const email = (u.email || '').toLowerCase();
      return name.includes(text) || email.includes(text);
    });

    if (filtered.length === 0) {
      container.innerHTML = `<span style="font-size: 0.78rem; color: #94a3b8; text-align: center; padding: 0.5rem;">Kullanıcı bulunamadı</span>`;
      return;
    }

    container.innerHTML = filtered.map(u => {
      const isChecked = this.quickSelectedUserIds.has(u.id);
      const fullName = `${u.first_name || ''} ${u.last_name || ''}`.trim() || u.email;
      return `
        <label style="display: flex; align-items: center; gap: 0.5rem; font-size: 0.82rem; color: #0f172a; padding: 0.25rem 0.4rem; border-radius: 6px; cursor: pointer; transition: background 0.15s; ${isChecked ? 'background: #eff6ff;' : ''}">
          <input type="checkbox" value="${u.id}" ${isChecked ? 'checked' : ''} onchange="Meetings.toggleQuickUserSelection('${u.id}')" style="accent-color: #5b5fc7; width: 15px; height: 15px;">
          <span style="font-weight: 700;">${fullName}</span>
          <span style="font-size: 0.74rem; color: #64748b; margin-left: auto;">(${u.email})</span>
        </label>
      `;
    }).join('');
    this.renderQuickSelectedChips();
  },

  filterQuickParticipantList(query) {
    this.renderQuickUsersListContainer(query);
  },

  toggleQuickUserSelection(userId) {
    if (this.quickSelectedUserIds.has(userId)) {
      this.quickSelectedUserIds.delete(userId);
    } else {
      this.quickSelectedUserIds.add(userId);
    }
    this.renderQuickSelectedChips();
    this.renderQuickUsersListContainer(document.getElementById('quickParticipantSearchInput')?.value || '');
  },

  toggleQuickSelectAll(forceAll = false) {
    const btn = document.getElementById('btnQuickSelectAll');
    if (forceAll || this.quickSelectedUserIds.size < this.companyUsers.length) {
      this.companyUsers.forEach(u => this.quickSelectedUserIds.add(u.id));
      if (btn) {
        btn.style.background = '#5b5fc7';
        btn.style.color = '#ffffff';
        btn.innerHTML = `<i class="fas fa-undo"></i> Seçimi Sıfırla`;
      }
    } else {
      this.quickSelectedUserIds.clear();
      if (btn) {
        btn.style.background = '#f1f5f9';
        btn.style.color = '#5b5fc7';
        btn.innerHTML = `<i class="fas fa-check-double"></i> Herkesi Davet Et`;
      }
    }
    this.renderQuickSelectedChips();
    this.renderQuickUsersListContainer(document.getElementById('quickParticipantSearchInput')?.value || '');
  },

  renderQuickSelectedChips() {
    const badge = document.getElementById('quickParticipantCountBadge');
    if (badge) {
      const count = this.quickSelectedUserIds.size;
      badge.textContent = count > 0 ? `(${count} kişi seçildi)` : '(İsteğe bağlı)';
      badge.style.color = count > 0 ? '#5b5fc7' : '#64748b';
    }

    const container = document.getElementById('quickSelectedChips');
    if (!container) return;

    if (this.quickSelectedUserIds.size === 0) {
      container.innerHTML = '';
      return;
    }

    const selectedUsers = this.companyUsers.filter(u => this.quickSelectedUserIds.has(u.id));
    container.innerHTML = selectedUsers.map(u => {
      const fullName = `${u.first_name || ''} ${u.last_name || ''}`.trim() || u.email;
      return `
        <span style="background: #eeefec; color: #5b5fc7; font-size: 0.75rem; font-weight: 700; padding: 0.2rem 0.55rem; border-radius: 12px; display: inline-flex; align-items: center; gap: 0.35rem; border: 1px solid #c7d2fe;">
          ${fullName}
          <button type="button" onclick="Meetings.toggleQuickUserSelection('${u.id}')" style="background: none; border: none; color: #5b5fc7; cursor: pointer; font-size: 0.85rem; padding: 0; line-height: 1;">&times;</button>
        </span>
      `;
    }).join('');
  },

  openCreateModal() {
    const modal = document.getElementById('createMeetingModal');
    if (modal) {
      modal.classList.add('active');
      modal.style.setProperty('display', 'flex', 'important');
      modal.style.setProperty('opacity', '1', 'important');
      modal.style.setProperty('pointer-events', 'auto', 'important');
      modal.style.setProperty('z-index', '99999', 'important');
    }

    this.selectedUserIds.clear();
    const btn = document.getElementById('btnCreateSelectAll');
    if (btn) {
      btn.style.background = '#f1f5f9';
      btn.style.color = '#5b5fc7';
      btn.innerHTML = `<i class="fas fa-check-double"></i> Herkesi Davet Et`;
    }
    this.renderSelectedChips();
    this.generateRandomPasscode();

    const startInput = document.getElementById('createStart');
    if (startInput) {
      const now = new Date();
      const pad = (n) => String(n).padStart(2, '0');
      startInput.value = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}T${pad(now.getHours())}:${pad(now.getMinutes())}`;
    }

    this.loadCompanyUsers();
  },

  closeCreateModal() {
    const modal = document.getElementById('createMeetingModal');
    if (modal) {
      modal.classList.remove('active');
      modal.style.setProperty('display', 'none', 'important');
      modal.style.setProperty('opacity', '0', 'important');
      modal.style.setProperty('pointer-events', 'none', 'important');
    }
  },

  async openQuickMeetingModal() {
    const modal = document.getElementById('quickMeetingModal');
    if (modal) {
      modal.classList.add('active');
      modal.style.setProperty('display', 'flex', 'important');
      modal.style.setProperty('opacity', '1', 'important');
      modal.style.setProperty('pointer-events', 'auto', 'important');
      modal.style.setProperty('z-index', '99999', 'important');
    }

    this.quickSelectedUserIds.clear();
    await this.loadCompanyUsers();
    // Varsayılan olarak HERKESİ DAVET ET aktif
    this.toggleQuickSelectAll(true);
    // BUG FIX: Hızlı toplantı eskiden hiç şifre üretmiyordu (misafirler
    // şifresiz doğrudan girebiliyordu) — tam form (Planla) ile tutarlı
    // olsun diye burada da otomatik bir oda anahtarı üretiliyor.
    this.generateRandomPasscode('quickPasscode');
  },

  closeQuickMeetingModal() {
    const modal = document.getElementById('quickMeetingModal');
    if (modal) {
      modal.classList.remove('active');
      modal.style.setProperty('display', 'none', 'important');
      modal.style.setProperty('opacity', '0', 'important');
      modal.style.setProperty('pointer-events', 'none', 'important');
    }
  },

  /**
   * Sunucudan gelen ISO tarih string'ini (TR yerel saatine göre, tzinfo'suz —
   * bkz. app/core/tz.py to_tr_naive) <input type="datetime-local"> için
   * beklenen "YYYY-MM-DDTHH:MM" biçimine çevirir. BİLEREK bir Date nesnesi
   * üzerinden GEÇİRİLMİYOR — tarayıcının kendi saat dilimine göre kayma
   * yapmasını önlemek için ilk 16 karakter doğrudan alınıyor (history.js'teki
   * parseDate()'in aynı sorunu farklı bir yöntemle çözen deseniyle tutarlı).
   */
  toDatetimeLocalValue(isoStr) {
    if (!isoStr) return '';
    return String(isoStr).slice(0, 16);
  },

  openEditModal(meetingId) {
    const m = (this.allMeetings || []).find(item => String(item.id) === String(meetingId));
    const modal = document.getElementById('editMeetingModal');
    if (!modal) return;

    if (m) {
      const idEl = document.getElementById('editMeetingId');
      const titleEl = document.getElementById('editTitle');
      const typeEl = document.getElementById('editMeetingType');
      const startEl = document.getElementById('editStart');
      const durationEl = document.getElementById('editDuration');
      const descEl = document.getElementById('editDescription');
      const agendaEl = document.getElementById('editAgenda');
      const passcodeEl = document.getElementById('editPasscode');
      const lobbyEl = document.getElementById('editLobbyEnabled');

      if (idEl) idEl.value = m.id;
      if (titleEl) titleEl.value = m.title || '';
      // BUG FIX: Toplantı Oluştur'daki (katılımcı davet etme hariç) tüm
      // alanlar burada da düzenlenebiliyor artık — Tür ve Süre de dahil.
      if (typeEl) typeEl.value = m.meeting_type || 'Planlı Toplantı';
      if (startEl) startEl.value = this.toDatetimeLocalValue(m.scheduled_start);

      const startMs = m.scheduled_start ? new Date(m.scheduled_start).getTime() : null;
      const endMs = m.scheduled_end ? new Date(m.scheduled_end).getTime() : null;
      const actualDuration = (startMs && endMs && endMs > startMs) ? Math.round((endMs - startMs) / 60000) : 30;
      if (durationEl) {
        // En yakın seçeneğe yuvarla — kayıtlı süre listede birebir yoksa
        // (ör. elle 37 dk girilmişse) select'in boş kalması yerine en yakını seçilir.
        const options = [15, 30, 45, 60, 90, 120];
        const closest = options.reduce((best, opt) => Math.abs(opt - actualDuration) < Math.abs(best - actualDuration) ? opt : best, options[0]);
        durationEl.value = String(closest);
      }

      if (descEl) descEl.value = m.description || '';
      if (agendaEl) agendaEl.value = m.agenda || '';
      if (passcodeEl) passcodeEl.value = m.passcode || '';
      // BUG FIX: Bekleme odası artık seçilebilir bir özellik değil — her
      // toplantıda sabit/garanti olarak açık. Eskiden burada `m.lobby_enabled`
      // okunup checkbox'a yazılıyordu; eski bir kayıt herhangi bir sebeple
      // false gelseydi, kaydet'e basınca lobiyi YANLIŞLIKLA kapatabilirdi.
      // Artık her zaman true'da sabit kalıyor (bkz. checkbox'ın kendisi de
      // gizli+checked, base.html).
      if (lobbyEl) lobbyEl.checked = true;
    }

    modal.classList.add('active');
    modal.style.setProperty('display', 'flex', 'important');
    modal.style.setProperty('opacity', '1', 'important');
    modal.style.setProperty('pointer-events', 'auto', 'important');
    modal.style.setProperty('z-index', '99999', 'important');
  },

  closeEditModal() {
    const modal = document.getElementById('editMeetingModal');
    if (modal) {
      modal.classList.remove('active');
      modal.style.setProperty('display', 'none', 'important');
      modal.style.setProperty('opacity', '0', 'important');
      modal.style.setProperty('pointer-events', 'none', 'important');
    }
  },

  async cancelMeeting(meetingId) {
    if (!confirm("Bu toplantıyı iptal etmek istediğinize emin misiniz?")) return;
    try {
      const res = await Auth.fetchWithAuth(`/api/v1/meetings/${meetingId}`, {
        method: 'DELETE'
      });
      if (res.ok) {
        alert("Toplantı başarıyla iptal edildi.");
        await this.loadMeetings();
        if (window.Dashboard && typeof window.Dashboard.loadStats === 'function') {
          await window.Dashboard.loadStats();
        }
      } else {
        const err = await res.json();
        alert("İptal işlemi başarısız: " + (err.detail || 'Hata oluştu'));
      }
    } catch (err) {
      console.error("Toplantı iptal hatası:", err);
      alert("Toplantı iptal edilirken bir hata oluştu.");
    }
  },

  /**
   * "İptal Et"ten farklı olarak toplantıyı ve tüm ilişkili kayıtlarını
   * (notlar, aksiyonlar, katılımcılar) HİÇBİR İZ BIRAKMADAN kalıcı olarak
   * siler (bkz. DELETE /api/v1/meetings/{id}/permanent). Geri alınamaz.
   */
  async deleteMeetingPermanently(meetingId) {
    if (!confirm("Bu toplantıyı KALICI OLARAK silmek istediğinize emin misiniz? Bu işlem geri alınamaz, toplantıyla ilgili tüm not ve kayıtlar da silinir.")) return;
    try {
      const res = await Auth.fetchWithAuth(`/api/v1/meetings/${meetingId}/permanent`, {
        method: 'DELETE'
      });
      if (res.ok) {
        alert("Toplantı kalıcı olarak silindi.");
        await this.loadMeetings();
        if (window.Dashboard && typeof window.Dashboard.loadStats === 'function') {
          await window.Dashboard.loadStats();
        }
      } else {
        const err = await res.json();
        alert("Silme işlemi başarısız: " + (err.detail || 'Hata oluştu'));
      }
    } catch (err) {
      console.error("Toplantı silme hatası:", err);
      alert("Toplantı silinirken bir hata oluştu.");
    }
  },

  openDetailsModal(meetingId) {
    this.showMeetingInfo(meetingId);
  },

  showMeetingInfo(meetingId) {
    const m = (this.allMeetings || []).find(item => String(item.id) === String(meetingId));
    const modal = document.getElementById('meetingDetailsModal');

    if (m) {
      const titleEl = document.getElementById('infoMeetingTitle');
      const badgeEl = document.getElementById('infoMeetingBadge');
      const hostEl = document.getElementById('infoMeetingHost');
      const activeCountEl = document.getElementById('infoMeetingActiveCount');
      const descEl = document.getElementById('infoMeetingDescription');
      const agendaEl = document.getElementById('infoMeetingAgenda');
      const timeRangeEl = document.getElementById('infoMeetingTimeRange');
      const securityEl = document.getElementById('infoMeetingSecurity');
      const listEl = document.getElementById('infoMeetingParticipantsList');
      const joinBtn = document.getElementById('infoMeetingJoinBtn');

      if (titleEl) titleEl.textContent = m.title || 'Toplantı Detayı';
      // BUG FIX: Burada eskiden anlamsız/gereksiz "Oda Kodu" gösteriliyordu —
      // artık toplantıyı düzenleyen (host) kişinin adı gösteriliyor.
      if (hostEl) hostEl.textContent = m.host_name || 'Bilinmiyor';
      // BUG FIX: Açıklama ve Gündem eskiden TEK alanda (m.agenda || m.description
      // ile biri diğerini eziyordu) gösteriliyordu — ikisi ayrı ayrı ve eksiksiz.
      if (descEl) descEl.textContent = m.description || 'Açıklama belirtilmedi.';
      if (agendaEl) agendaEl.textContent = m.agenda || 'Gündem belirtilmedi.';
      if (timeRangeEl) timeRangeEl.textContent = m.time_str || (m.scheduled_start ? new Date(m.scheduled_start).toLocaleString('tr-TR') : '-');
      if (securityEl) securityEl.textContent = m.passcode ? `Şifreli (${m.passcode})` : 'Şifresiz';
      // BUG FIX: Artık yeni sekmede açılıyor (bkz. base.html'deki target="_blank"),
      // burada sadece hedef güncelleniyor.
      if (joinBtn) joinBtn.href = `/prejoin/${m.meeting_code}`;

      const activeCount = m.active_count || (m.participants ? m.participants.length : 0);
      if (activeCountEl) activeCountEl.textContent = `${activeCount} Kişi Aktif`;

      if (badgeEl) {
        const isLive = this.normalizeStatus(m.status) === 'live';
        badgeEl.textContent = isLive ? 'CANLI' : (m.status || 'Planlandı').toUpperCase();
        badgeEl.style.background = isLive ? '#dcfce7' : '#e0e7ff';
        badgeEl.style.color = isLive ? '#166534' : '#3730a3';
      }

      if (listEl) {
        const parts = m.participants || m.active_participants || [];
        if (parts.length > 0) {
          listEl.innerHTML = parts.map(p => `
            <div style="display: flex; align-items: center; gap: 0.5rem; font-size: 0.85rem; padding: 0.25rem 0;">
              <div style="width: 26px; height: 26px; border-radius: 50%; background: #e0e7ff; color: #4338ca; display: flex; align-items: center; justify-content: center; font-size: 0.7rem; font-weight: 800;">
                ${p.initials || 'U'}
              </div>
              <span style="font-weight: 600; color: #0f172a;">${p.name || 'Kullanıcı'}</span>
            </div>
          `).join('');
        } else {
          listEl.innerHTML = '<span style="font-size: 0.8rem; color: #94a3b8;">Henüz katılan aktif üye yok.</span>';
        }
      }
    }

    if (modal) {
      modal.classList.add('active');
      modal.style.setProperty('display', 'flex', 'important');
      modal.style.setProperty('opacity', '1', 'important');
      modal.style.setProperty('pointer-events', 'auto', 'important');
      modal.style.setProperty('z-index', '99999', 'important');
    }
  },

  closeDetailsModal() {
    const modal = document.getElementById('meetingDetailsModal');
    if (modal) {
      modal.classList.remove('active');
      modal.style.setProperty('display', 'none', 'important');
      modal.style.setProperty('opacity', '0', 'important');
      modal.style.setProperty('pointer-events', 'none', 'important');
    }
  },

  toggleCardMenu(e, menuId) {
    if (e) {
      e.stopPropagation();
      e.preventDefault();
    }
    const targetId = menuId.startsWith('cardMenu_') ? menuId : `cardMenu_${menuId}`;
    document.querySelectorAll('.card-dropdown-menu').forEach(el => {
      if (el.id !== targetId) {
        el.style.display = 'none';
      }
    });

    const menuEl = document.getElementById(targetId) || document.getElementById(menuId);
    if (menuEl) {
      menuEl.style.display = menuEl.style.display === 'block' ? 'none' : 'block';
    }
  }
};

window.Meetings = Meetings;

document.addEventListener('click', (e) => {
  if (!e.target.closest('.card-dropdown-menu') && !e.target.closest('button')) {
    document.querySelectorAll('.card-dropdown-menu').forEach(el => el.style.display = 'none');
  }
});

document.addEventListener('DOMContentLoaded', () => {
  window.Meetings.init();

  const formEdit = document.getElementById('formEditMeeting');
  if (formEdit) {
    formEdit.addEventListener('submit', async (e) => {
      e.preventDefault();
      const meetingId = document.getElementById('editMeetingId').value;
      const title = document.getElementById('editTitle').value;
      const meetingType = document.getElementById('editMeetingType').value;
      const startVal = document.getElementById('editStart').value;
      const durationMin = parseInt(document.getElementById('editDuration').value || '30', 10);
      const description = document.getElementById('editDescription').value;
      const agenda = document.getElementById('editAgenda').value;
      const passcode = document.getElementById('editPasscode').value;
      const lobbyEnabled = document.getElementById('editLobbyEnabled').checked;

      try {
        const payload = {
          title: title,
          meeting_type: meetingType,
          description: description,
          agenda: agenda,
          passcode: passcode,
          lobby_enabled: lobbyEnabled
        };

        // BUG FIX: Süre artık (openEditModal'da otomatik korunan gizli bir
        // değer yerine) kullanıcının açıkça seçtiği "Tahmini Süre"den
        // hesaplanıyor — Toplantı Oluştur ile birebir aynı davranış.
        if (startVal) {
          const formattedStart = startVal.length === 16 ? startVal + ':00' : startVal;
          payload.scheduled_start = formattedStart;

          const startDate = new Date(startVal);
          if (!isNaN(startDate.getTime())) {
            const endDate = new Date(startDate.getTime() + durationMin * 60000);
            const pad = (n) => String(n).padStart(2, '0');
            payload.scheduled_end = `${endDate.getFullYear()}-${pad(endDate.getMonth() + 1)}-${pad(endDate.getDate())}T${pad(endDate.getHours())}:${pad(endDate.getMinutes())}:00`;
          }
        }

        const res = await Auth.fetchWithAuth(`/api/v1/meetings/${meetingId}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload)
        });

        if (res.ok) {
          Meetings.closeEditModal();
          await Meetings.loadMeetings();
          if (window.Dashboard && typeof window.Dashboard.loadStats === 'function') {
            await window.Dashboard.loadStats();
          }
          alert("Toplantı bilgileri başarıyla güncellendi.");
        } else {
          const err = await res.json();
          alert("Güncelleme başarısız: " + (err.detail || 'Hata'));
        }
      } catch (err) {
        console.error("Güncelleme hatası:", err);
        alert("Toplantı güncellenirken hata oluştu.");
      }
    });
  }

  const formCreate = document.getElementById('formCreateMeeting');
  if (formCreate) {
    formCreate.addEventListener('submit', async (e) => {
      e.preventDefault();
      const title = document.getElementById('createTitle').value;
      const meetingType = document.getElementById('createMeetingType').value || 'Planlı Toplantı';
      const start = document.getElementById('createStart').value;
      const duration = parseInt(document.getElementById('createDuration').value || '30', 10);
      const passcode = document.getElementById('createPasscode').value || '';
      const lobbyEnabled = document.getElementById('createLobbyEnabled').checked;
      const description = document.getElementById('createDescription').value || '';
      const agenda = document.getElementById('createAgenda').value || '';
      const invitedIds = Array.from(Meetings.selectedUserIds);

      let formattedStart = start;
      if (start) {
        if (start.length === 16) formattedStart = start + ':00';
      } else {
        const now = new Date();
        formattedStart = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}-${String(now.getDate()).padStart(2,'0')}T${String(now.getHours()).padStart(2,'0')}:${String(now.getMinutes()).padStart(2,'0')}:00`;
      }

      try {
        const payload = {
          title: title,
          meeting_type: meetingType,
          scheduled_start: formattedStart,
          duration_minutes: duration,
          passcode: passcode,
          lobby_enabled: lobbyEnabled,
          description: description,
          agenda: agenda,
          invited_user_ids: invitedIds
        };

        const res = await Auth.fetchWithAuth('/api/v1/meetings/', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload)
        });

        if (res.ok) {
          window.Meetings.closeCreateModal();
          await window.Meetings.loadMeetings();
        } else {
          let msg = 'Hata oluştu';
          try {
            const errData = await res.json();
            if (typeof errData.detail === 'string') msg = errData.detail;
            else if (Array.isArray(errData.detail)) msg = errData.detail.map(d => d.msg || JSON.stringify(d)).join(', ');
          } catch(e) {}
          alert('Toplantı oluşturulamadı: ' + msg);
        }
      } catch (err) {
        console.error("Toplantı oluşturma hatası:", err);
        alert("Toplantı oluşturulurken hata oluştu: " + (err.message || err));
      }
    });
  }

  // Quick Meeting Form Submission Handler
  const formQuick = document.getElementById('formQuickMeeting');
  if (formQuick) {
    formQuick.addEventListener('submit', async (e) => {
      e.preventDefault();
      try {
        const now = new Date();
        const localStart = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}-${String(now.getDate()).padStart(2,'0')}T${String(now.getHours()).padStart(2,'0')}:${String(now.getMinutes()).padStart(2,'0')}:${String(now.getSeconds()).padStart(2,'0')}`;
        // BUG FIX: Şifre eskiden hep "" (boş) gönderiliyordu — misafirler bu
        // odaya hiç şifresiz doğrudan girebiliyordu. Artık tam form (Planla)
        // ile tutarlı şekilde, modal açılışında otomatik üretilen anahtar
        // kullanılıyor (kullanıcı isterse elle değiştirebilir).
        const quickPasscode = document.getElementById('quickPasscode')?.value || '';
        // BUG FIX: "Hızlı Toplantı" değeri Düzenle modallarındaki (editMeetingType/
        // roomSettingsType) hiçbir seçenekle eşleşmiyordu — bu toplantı daha
        // sonra düzenlenmek istendiğinde tür alanı sessizce ilk seçeneğe
        // düşüyordu. "Anlık Toplantı" hem anlamsal olarak doğru hem de o
        // listelerde gerçekten var olan bir seçenek.
        const payload = {
          title: "Hızlı Toplantı",
          scheduled_start: localStart,
          duration_minutes: 60,
          meeting_type: "Anlık Toplantı",
          agenda: "Anlık hızlı başlatılan oturum",
          description: "Hızlı Oturum",
          passcode: quickPasscode,
          lobby_enabled: true,
          invited_user_ids: Array.from(Meetings.quickSelectedUserIds)
        };

        const res = await Auth.fetchWithAuth('/api/v1/meetings/', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload)
        });

        if (res.ok) {
          const data = await res.json();
          window.Meetings.closeQuickMeetingModal();
          await window.Meetings.loadMeetings();
          // BUG FIX: Ana panel sekmesi dashboard'da kalıyor, toplantı akışı
          // yeni sekmede açılıyor (bkz. Meetings.openMeetingInNewTab).
          window.Meetings.openMeetingInNewTab(data.meeting_code);
        } else {
          let msg = 'Hata oluştu';
          try {
            const err = await res.json();
            if (typeof err.detail === 'string') msg = err.detail;
            else if (Array.isArray(err.detail)) msg = err.detail.map(d => d.msg || JSON.stringify(d)).join(', ');
          } catch(e) {}
          alert("Hızlı toplantı başlatılamadı: " + msg);
        }
      } catch (err) {
        console.error("Hızlı toplantı hatası:", err);
        alert("Hızlı toplantı başlatılırken hata oluştu: " + (err.message || err));
      }
    });
  }
});
