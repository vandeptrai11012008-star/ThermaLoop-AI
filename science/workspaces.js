/* Progressive navigation only: retain the existing DOM, inputs and model instances. */
(() => {
  'use strict';
  function setup() {
    const $ = id => document.getElementById(id);
    const content = $('world'), menu = document.querySelector('.side .menu');
    if (!content || !menu) return;
    const definitions = [
      {id:'overview', title:'Overview', icon:'◈', note:'Explore the conceptual 64-GPU campus and its synthetic operating signals.', panels:[
        {anchor:'digital-twin', title:'3D facility', selectors:['.intro','#digital-twin','.world-frame','.stats-row']},
        {anchor:'analytics', title:'Live analytics', selectors:['#analytics','.analytic-grid']}
      ]},
      {id:'experiments', title:'Experiments', icon:'⇄', note:'Compare controlled scenarios and public workload replays. These are separate experiments, not measured deployment savings.', panels:[
        {anchor:'comparison', title:'Before / After', selectors:['#comparison']},
        {anchor:'experiment-studio', title:'Strategy studio', selectors:['#experiment-studio']},
        {anchor:'gpu-lab', title:'GPU allocation', selectors:['#gpu-lab']},
        {anchor:'control', title:'Policies & diagnostics', selectors:['#control','.config-grid','#diagnostics']},
        {anchor:'public-workloads', title:'Public workloads', selectors:['#public-workloads']}
      ]},
      {id:'thermal', title:'Thermal models', icon:'≋', note:'Inspect the separate 8-GPU thermal reference, calibration limits and numerical checks. These do not validate the 64-GPU 3D campus.', panels:[
        {anchor:'physical-model', title:'Finite-capacity CDU', selectors:['#physical-model']},
        {anchor:'scientific-validation', title:'Cooling validation', selectors:['#scientific-validation']},
        {anchor:'numerical-verification', title:'Numerical verification', selectors:['#numerical-verification']}
      ]},
      {id:'agents', title:'Agent Sandbox', icon:'◇', note:'Propose building-control actions, simulate their physical consequences and export evidence. No real equipment is connected.', panels:[
        {anchor:'agent-sandbox', title:'Control experiments', selectors:['#agent-sandbox']}
      ]},
      {id:'economics', title:'Economics', icon:'＄', note:'Explore financial scenarios with explicit synthetic workload, hardware and electricity assumptions.', panels:[
        {anchor:'scale-lab', title:'Scale & financial impact', selectors:['#scale-lab']}
      ]},
      {id:'evidence', title:'Scientific evidence', icon:'⚗', note:'Inspect public data, assumptions and reproducible comparisons. Field sensors remain disconnected.', panels:[
        {anchor:'scientific-evidence', title:'Evidence dashboard', selectors:['#scientific-evidence']}
      ]}
    ];
    // Resolve everything before moving nodes; a partial document keeps its original layout.
    for (const group of definitions) for (const panel of group.panels) {
      panel.nodes = panel.selectors.map(selector => content.querySelector(selector));
      if (panel.nodes.some(node => !node)) return;
    }
    const fragment = document.createDocumentFragment();
    for (const [index, group] of definitions.entries()) {
      const screen = document.createElement('section');
      screen.id = 'workspace-' + group.id;
      screen.className = 'workspace-screen';
      screen.dataset.workspace = group.id;
      screen.setAttribute('aria-label', group.title);
      if (group.id !== 'overview') {
        const header = document.createElement('header');header.className = 'workspace-heading';
        const label = document.createElement('p');label.className = 'workspace-kicker';label.textContent = 'RESEARCH WORKSPACE / ' + String(index + 1).padStart(2,'0');
        const title = document.createElement('h1');title.textContent = group.title;
        const note = document.createElement('p');note.textContent = group.note;
        header.append(label,title,note);screen.append(header);
      }
      const nav = document.createElement('nav');nav.className = 'workspace-sections';nav.setAttribute('aria-label',group.title + ' sections');
      group.links = [];
      for (const panel of group.panels) {
        const link = document.createElement('a');link.href = '#' + panel.anchor;link.textContent = panel.title;
        link.dataset.workspaceSection = panel.anchor;nav.append(link);group.links.push(link);
        const body = document.createElement('div');body.className = 'workspace-panel';body.dataset.workspacePanel = panel.anchor;
        for (const node of panel.nodes) if (node.classList.contains('validation-workspace')) node.classList.add('science-lab');
        body.append(...panel.nodes);panel.element = body;screen.append(body);
      }
      if (group.panels.length > 1) screen.prepend(nav);
      // Keep the heading above the section links for the non-overview screens.
      if (group.id !== 'overview' && group.panels.length > 1) screen.prepend(screen.querySelector('.workspace-heading'));
      group.element = screen;group.lastAnchor = group.panels[0].anchor;fragment.append(screen);
    }
    // The nested labs have already moved out of the evidence dashboard above.
    content.prepend(fragment);
    menu.replaceChildren();menu.setAttribute('aria-label','Research workspaces');
    for (const [index, group] of definitions.entries()) {
      const link = document.createElement('a');link.className = 'menu-item';link.href = '#' + group.lastAnchor;
      link.dataset.workspaceLink = group.id;
      const icon = document.createElement('span');icon.setAttribute('aria-hidden','true');icon.textContent = group.icon;
      const number = document.createElement('em');number.textContent = String(index + 1).padStart(2,'0');
      link.append(icon,document.createTextNode(group.title),number);menu.append(link);group.link = link;
    }
    const quick = document.createElement('nav');quick.className = 'workspace-mobile-nav';quick.setAttribute('aria-label','Research workspaces');
    for (const group of definitions) {
      const link = document.createElement('a');link.href = '#' + group.lastAnchor;link.textContent = group.title;link.dataset.workspaceLink = group.id;quick.append(link);
    }
    content.before(quick);
    document.documentElement.classList.add('has-workspaces');
    const baseTitle = document.title;let active = null;
    function resolve(hash) {
      let id;try { id = decodeURIComponent(hash.replace(/^#/,'')); } catch { return null; }
      const target = $(id);
      if (id === 'world' || !id) return {group:definitions[0],panel:definitions[0].panels[0],target:null};
      if (!target) return null;
      for (const group of definitions) for (const panel of group.panels) {
        if (panel.element === target || panel.element.contains(target)) return {group,panel,target};
      }
      return null;
    }
    function display(route, focus = false) {
      if (!route) return;
      const {group,panel,target} = route;
      for (const g of definitions) {
        g.element.hidden = g !== group;
        for (const p of g.panels) p.element.hidden = g !== group || p !== panel;
        for (const link of g.links) {
          if (g === group && link.dataset.workspaceSection === panel.anchor) link.setAttribute('aria-current','location');
          else link.removeAttribute('aria-current');
        }
      }
      group.lastAnchor = panel.anchor;
      for (const link of document.querySelectorAll('[data-workspace-link]')) {
        const g = definitions.find(x => x.id === link.dataset.workspaceLink);
        link.href = '#' + g.lastAnchor;link.classList.toggle('active',g === group);
        if (g === group) link.setAttribute('aria-current','page');else link.removeAttribute('aria-current');
      }
      // A deep link to a source, assumption or equation opens its enclosing details.
      for (let node = target; node && node !== panel.element; node = node.parentElement) if (node.tagName === 'DETAILS') node.open = true;
      document.title = group.id === 'overview' ? baseTitle : 'ThermaLoop AI | ' + group.title;
      active = {workspace:group.id,panel:panel.anchor};
      const nested = target && target.id !== panel.anchor;
      if (nested) target.scrollIntoView({block:'start',behavior:'instant'});else window.scrollTo({top:0,behavior:'instant'});
      if (focus) {
        const heading = nested ? target : (group.element.querySelector('.workspace-heading h1') || panel.element.querySelector('h1,h2'));
        if (heading) { if (!heading.hasAttribute('tabindex')) heading.setAttribute('tabindex','-1');heading.focus({preventScroll:true}); }
      }
      // Existing canvas renderers skip hidden dimensions; redraw after layout is visible.
      window.dispatchEvent(new Event('resize'));
      document.dispatchEvent(new CustomEvent('thermaloop:workspacechange',{detail:{...active}}));
    }
    function navigate(hash, focus = false) {
      const route = resolve(hash);if (!route) return false;
      if (location.hash !== hash) history.pushState(null,'',hash);
      display(route,focus);return true;
    }
    document.addEventListener('click', event => {
      if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      const link = event.target.closest('a[href]');if (!link || link.target || link.hasAttribute('download')) return;
      const url = new URL(link.href,location.href);
      if (url.origin === location.origin && url.pathname === location.pathname && url.search === location.search && url.hash && resolve(url.hash)) {
        event.preventDefault();navigate(url.hash,true);
      }
    });
    // Reveal the 3D scene before its existing cross-screen inspector handlers run.
    document.addEventListener('click', event => {
      if (event.target.closest('#compareJump,#gpuFocusBtn,#gpuMatrix [role="button"],[data-cascade]')) navigate('#scene-stage');
    },true);
    const fromHistory = () => display(resolve(location.hash) || resolve(''));
    window.addEventListener('hashchange',fromHistory);window.addEventListener('popstate',fromHistory);
    window.ThermaWorkspaces = {navigate,getState:() => ({...active})};
    fromHistory();
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded',setup);else setup();
})();
