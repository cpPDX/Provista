// Onboarding: Setup wizard (for new owners) + App walkthrough (for all users)

// ===== Setup Wizard =====
// Shown once after a new household owner's first login.
// Guides them through: adding their first store, understanding the tabs.

function shouldShowSetupWizard() {
  const auth = window.appAuth;
  if (!auth.isOwner()) return false;
  return !localStorage.getItem('gt_wizard_done_' + auth.user._id);
}

function markWizardDone() {
  localStorage.setItem('gt_wizard_done_' + window.appAuth.user._id, '1');
}

function startSetupWizard() {
  const name = window.appAuth.user.name?.split(' ')[0] || 'there';
  const steps = [
    {
      title: 'Welcome, ' + name + '!',
      body: `
        <p>Your household is all set up and loaded with ~200 common grocery items.</p>
        <p style="margin-top:0.75rem">Let's walk through a few things to get you started.</p>`,
      icon: '👋'
    },
    {
      title: 'Add your stores',
      body: `
        <p>Start by adding the stores you shop at. You can do this from <strong>More → Stores</strong>, or on-the-fly when logging a price.</p>
        <p style="margin-top:0.5rem">Examples: Costco, Trader Joe's, Safeway, etc.</p>`,
      icon: '🏪'
    },
    {
      title: 'Log a price',
      body: `
        <p>Head to the <strong>Prices</strong> tab and tap <strong>+ Add Price</strong>. Pick an item, pick a store, and enter what you paid.</p>
        <p style="margin-top:0.5rem">You can also <strong>scan receipts</strong> to log multiple items at once — just head to the <strong>Scan</strong> tab.</p>`,
      icon: '💰'
    },
    {
      title: 'Invite your household',
      body: `
        <p>Go to <strong>More → Household → Show Invite Code</strong> to get a QR code or 6-digit code.</p>
        <p style="margin-top:0.5rem">Share it with family or housemates. They'll see the same prices, shopping list, and inventory.</p>`,
      icon: '👥'
    },
    {
      title: 'You\'re all set!',
      body: `
        <p>That's the basics. You can revisit the app tour anytime from <strong>More → App Tour</strong>.</p>
        <p style="margin-top:0.5rem">Happy tracking!</p>`,
      icon: '🎉'
    }
  ];

  showWizardOverlay(steps, () => {
    markWizardDone();
  });
}

function showWizardOverlay(steps, onComplete) {
  let current = 0;
  const overlay = document.createElement('div');
  overlay.className = 'wizard-overlay';
  overlay.innerHTML = `
    <div class="wizard-card">
      <div class="wizard-icon" id="wizard-icon"></div>
      <h2 class="wizard-title" id="wizard-title"></h2>
      <div class="wizard-body" id="wizard-body"></div>
      <div class="wizard-dots" id="wizard-dots"></div>
      <div class="wizard-actions">
        <button class="btn btn-outline" id="wizard-skip">Skip</button>
        <button class="btn btn-primary" id="wizard-next">Next</button>
      </div>
    </div>`;
  document.body.appendChild(overlay);
  // Force reflow for animation
  requestAnimationFrame(() => overlay.classList.add('visible'));

  function render() {
    const step = steps[current];
    document.getElementById('wizard-icon').textContent = step.icon;
    document.getElementById('wizard-title').textContent = step.title;
    document.getElementById('wizard-body').innerHTML = step.body;
    document.getElementById('wizard-dots').innerHTML = steps.map((_, i) =>
      `<span class="wizard-dot ${i === current ? 'active' : ''}"></span>`
    ).join('');
    document.getElementById('wizard-next').textContent = current === steps.length - 1 ? 'Get Started' : 'Next';
    document.getElementById('wizard-skip').style.display = current === steps.length - 1 ? 'none' : '';
  }

  document.getElementById('wizard-next').addEventListener('click', () => {
    if (current < steps.length - 1) {
      current++;
      render();
    } else {
      close();
    }
  });

  document.getElementById('wizard-skip').addEventListener('click', close);

  function close() {
    overlay.classList.remove('visible');
    setTimeout(() => overlay.remove(), 300);
    if (onComplete) onComplete();
  }

  render();
}

// ===== App Walkthrough =====
// Step-by-step tooltip tour highlighting each tab.

function startAppTour() {
  const steps = [
    {
      tab: 'prices',
      title: 'Prices',
      text: 'This is your price log. Every item you buy gets tracked here with its regular price, sale price, and coupons. Tap any item to see its full history and compare stores.',
      anchor: '[data-tab="prices"]'
    },
    {
      tab: 'list',
      title: 'Shopping List',
      text: 'Build your shopping list here. Each item automatically shows the best known price and which store to go to. Share the list with your whole household.',
      anchor: '[data-tab="list"]'
    },
    {
      tab: 'scan',
      title: 'Scan Receipts',
      text: 'Take a photo of your receipt and the app reads it using OCR — right on your phone, no data sent anywhere. It pulls out item names and prices for you to review and save.',
      anchor: '[data-tab="scan"]'
    },
    {
      tab: 'spend',
      title: 'Spend Analytics',
      text: 'See where your money goes — broken down by month, category, and store. Tracks only what you\'ve logged, so the more you use it, the more useful this gets.',
      anchor: '[data-tab="spend"]'
    },
    {
      tab: 'more',
      title: 'More',
      text: 'Manage your inventory, item catalog, stores, household members, and account settings. Admins can also review pending price submissions here.',
      anchor: '[data-tab="more"]'
    }
  ];

  let current = 0;

  // Create tour elements
  const backdrop = document.createElement('div');
  backdrop.className = 'tour-backdrop';
  document.body.appendChild(backdrop);

  const tooltip = document.createElement('div');
  tooltip.className = 'tour-tooltip';
  tooltip.innerHTML = `
    <div class="tour-tooltip-title" id="tour-title"></div>
    <div class="tour-tooltip-text" id="tour-text"></div>
    <div class="tour-tooltip-footer">
      <span class="tour-step-count" id="tour-count"></span>
      <div class="tour-tooltip-actions">
        <button class="btn btn-outline btn-sm" id="tour-skip">Skip</button>
        <button class="btn btn-primary btn-sm" id="tour-next">Next</button>
      </div>
    </div>`;
  document.body.appendChild(tooltip);

  requestAnimationFrame(() => {
    backdrop.classList.add('visible');
    tooltip.classList.add('visible');
  });

  function render() {
    const step = steps[current];

    // Switch to the tab
    switchTab(step.tab);

    // Highlight the nav item
    document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('tour-highlight'));
    const anchor = document.querySelector(step.anchor);
    if (anchor) anchor.classList.add('tour-highlight');

    document.getElementById('tour-title').textContent = step.title;
    document.getElementById('tour-text').textContent = step.text;
    document.getElementById('tour-count').textContent = `${current + 1} of ${steps.length}`;
    document.getElementById('tour-next').textContent = current === steps.length - 1 ? 'Done' : 'Next';
    document.getElementById('tour-skip').style.display = current === steps.length - 1 ? 'none' : '';

    // Position tooltip above nav bar
    const navRect = document.querySelector('.bottom-nav').getBoundingClientRect();
    tooltip.style.bottom = (window.innerHeight - navRect.top + 12) + 'px';
  }

  document.getElementById('tour-next').addEventListener('click', () => {
    if (current < steps.length - 1) {
      current++;
      render();
    } else {
      close();
    }
  });

  document.getElementById('tour-skip').addEventListener('click', close);
  backdrop.addEventListener('click', close);

  function close() {
    document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('tour-highlight'));
    backdrop.classList.remove('visible');
    tooltip.classList.remove('visible');
    setTimeout(() => {
      backdrop.remove();
      tooltip.remove();
    }, 300);
    // Return to prices tab
    switchTab('prices');
  }

  render();
}
