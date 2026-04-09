// Onboarding: Interactive Setup Wizard + App Tour

// ===== Setup Wizard Persistence =====

function wizardStepKey()      { return 'gt_wizard_step_'      + window.appAuth.user._id; }
function wizardDoneKey()      { return 'gt_wizard_done_'      + window.appAuth.user._id; }
function newHouseholdKey()    { return 'gt_new_household_'    + window.appAuth.user._id; }

function shouldShowSetupWizard() {
  if (!window.appAuth.isOwner()) return false;
  return !!localStorage.getItem(newHouseholdKey()); // one-shot: only after household creation
}

function shouldShowResumeButton() {
  if (!window.appAuth.isOwner()) return false;
  return !localStorage.getItem(wizardDoneKey());
}

function savedWizardStep() {
  return parseInt(localStorage.getItem(wizardStepKey()) || '0', 10);
}

function saveWizardStep(step) {
  localStorage.setItem(wizardStepKey(), String(step));
}

function markWizardDone() {
  localStorage.setItem(wizardDoneKey(), '1');
  localStorage.removeItem(wizardStepKey());
  // Hide the "Continue Setup" button in More menu
  const btn = document.getElementById('btn-resume-setup');
  if (btn) btn.style.display = 'none';
}

// ===== Setup Wizard Steps =====
// Each step navigates the app and highlights a specific element.

const WIZARD_STEPS = [
  {
    tab: 'more',
    section: 'stores',
    sectionLoader: async () => { await loadStores(); },
    targetId: 'btn-add-store',
    actionId: 'add-store',
    title: 'Step 1 of 4 — Add your stores',
    text: 'Start by adding the grocery stores you shop at (Costco, Trader Joe\'s, Safeway…). Tap + Add Store — the wizard advances automatically when you save.',
    nextLabel: 'Skip'
  },
  {
    tab: 'prices',
    section: null,
    sectionLoader: null,
    targetId: 'btn-add-price',
    actionId: 'add-price',
    title: 'Step 2 of 4 — Log a price',
    text: 'Use the Prices tab to record what you paid for each item. Tap + Log Price and fill it in — the wizard advances automatically when you save. You can also import a CSV of past prices.',
    nextLabel: 'Skip'
  },
  {
    tab: 'more',
    section: 'household',
    sectionLoader: async () => {
      await loadHousehold();
      // Auto-expand invite section after a short delay
      setTimeout(async () => {
        const btn = document.getElementById('btn-show-invite');
        if (btn) {
          btn.style.display = 'none'; // hide the button, show inline
          await loadInviteCode();
        }
      }, 400);
    },
    targetId: 'household-content',
    title: 'Step 3 of 4 — Invite your household',
    text: 'Share your invite code or QR code with family. They\'ll join your household and see prices, the shopping list, and inventory.',
    nextLabel: 'Next'
  },
  {
    tab: 'prices',
    section: null,
    sectionLoader: null,
    targetId: null,
    title: 'You\'re all set! 🎉',
    text: 'Keep logging prices and the app builds a picture of where to find the best deals. You can revisit this tour anytime from More → App Tour.',
    nextLabel: 'Get Started'
  }
];

// ===== Interactive Wizard =====

let wizardActive = false;

async function startSetupWizard(fromStep) {
  if (wizardActive) return;
  localStorage.removeItem(newHouseholdKey()); // clear one-shot trigger
  const startStep = fromStep ?? savedWizardStep();
  runWizard(startStep);
}

function runWizard(startStep) {
  wizardActive = true;
  document.body.classList.add('wizard-active');
  let current = startStep;

  // Elements
  const backdrop = document.createElement('div');
  backdrop.className = 'tour-backdrop';
  backdrop.style.pointerEvents = 'none'; // allow tapping through to highlighted elements
  backdrop.style.background = 'transparent'; // no dark tint — wizard is non-blocking
  document.body.appendChild(backdrop);
  // Do NOT add 'visible' class — keep backdrop fully transparent for wizard

  const tooltip = document.createElement('div');
  tooltip.className = 'tour-tooltip wizard-tooltip';
  tooltip.innerHTML = `
    <div class="wizard-step-badge" id="wizard-badge"></div>
    <div class="tour-tooltip-title" id="wizard-title"></div>
    <div class="tour-tooltip-text" id="wizard-text"></div>
    <div class="tour-tooltip-footer">
      <button class="btn btn-outline btn-sm" id="wizard-skip">Skip Setup</button>
      <button class="btn btn-primary btn-sm" id="wizard-next">Next</button>
    </div>`;
  document.body.appendChild(tooltip);

  requestAnimationFrame(() => {
    // Only show tooltip, not backdrop (backdrop stays transparent for wizard)
    tooltip.classList.add('visible');
  });

  async function renderStep() {
    const step = WIZARD_STEPS[current];
    saveWizardStep(current);

    // Remove previous highlight
    document.querySelectorAll('.wizard-highlight').forEach(el => el.classList.remove('wizard-highlight'));

    // Navigate to the right tab/section
    if (step.tab === 'more' && step.section) {
      await switchTab('more');
      showMoreSection(step.section);
      if (step.sectionLoader) await step.sectionLoader();
    } else {
      await switchTab(step.tab);
    }

    // Highlight target element
    if (step.targetId) {
      const target = document.getElementById(step.targetId);
      if (target) {
        target.classList.add('wizard-highlight');
        setTimeout(() => target.scrollIntoView({ behavior: 'smooth', block: 'center' }), 100);
      }
    }

    // Register auto-advance hook for actionable steps
    window.onWizardActionComplete = step.actionId ? (completedId) => {
      if (completedId === step.actionId && wizardActive) {
        current++;
        renderStep();
      }
    } : null;

    // Update tooltip content
    document.getElementById('wizard-title').textContent = step.title;
    document.getElementById('wizard-text').textContent = step.text;
    document.getElementById('wizard-next').textContent = step.nextLabel;

    const badge = document.getElementById('wizard-badge');
    badge.style.display = current < WIZARD_STEPS.length - 1 ? '' : 'none';

    // Position tooltip above nav bar
    const navRect = document.querySelector('.bottom-nav').getBoundingClientRect();
    tooltip.style.bottom = (window.innerHeight - navRect.top + 12) + 'px';
  }

  document.getElementById('wizard-next').addEventListener('click', async () => {
    if (current < WIZARD_STEPS.length - 1) {
      current++;
      await renderStep();
    } else {
      complete();
    }
  });

  document.getElementById('wizard-skip').addEventListener('click', skip);

  function skip() {
    close();
    // Don't mark as done — leave resume button visible
  }

  function complete() {
    markWizardDone();
    close();
    switchTab('prices');
  }

  function close() {
    wizardActive = false;
    document.body.classList.remove('wizard-active');
    window.onWizardActionComplete = null;
    document.querySelectorAll('.wizard-highlight').forEach(el => el.classList.remove('wizard-highlight'));
    backdrop.classList.remove('visible');
    tooltip.classList.remove('visible');
    setTimeout(() => { backdrop.remove(); tooltip.remove(); }, 300);
  }

  renderStep();
}

// ===== App Tour =====

function startAppTour() {
  const steps = [
    {
      tab: 'prices',
      title: 'Product Prices',
      text: 'Your price log. Log prices manually or import from CSV. Tap any item to see its full history and compare stores.',
      anchor: '[data-tab="prices"]'
    },
    {
      tab: 'list',
      title: 'Shopping List',
      text: 'Build your shopping list here. Each item shows the best known price and which store to go to. The whole household shares the same list.',
      anchor: '[data-tab="list"]'
    },
    {
      tab: 'spend',
      title: 'Spend Analytics',
      text: 'See where your money goes — broken down by month, category, and store. The more you log, the more useful this gets.',
      anchor: '[data-tab="spend"]'
    },
    {
      tab: 'more',
      title: 'More',
      text: 'Manage inventory, product catalog, stores, household members, and your account. Admins can also review pending price submissions here.',
      anchor: '[data-tab="more"]'
    }
  ];

  let current = 0;

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
    switchTab(step.tab);

    document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('tour-highlight'));
    const anchor = document.querySelector(step.anchor);
    if (anchor) anchor.classList.add('tour-highlight');

    document.getElementById('tour-title').textContent = step.title;
    document.getElementById('tour-text').textContent = step.text;
    document.getElementById('tour-count').textContent = `${current + 1} of ${steps.length}`;
    document.getElementById('tour-next').textContent = current === steps.length - 1 ? 'Done' : 'Next';
    document.getElementById('tour-skip').style.display = current === steps.length - 1 ? 'none' : '';

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
    setTimeout(() => { backdrop.remove(); tooltip.remove(); }, 300);
    switchTab('prices');
  }

  render();
}
