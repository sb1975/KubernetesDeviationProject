const fs = require('fs');
const PptxGenJS = require('pptxgenjs');

const input = '/home/esudbat/KubernetesDeviationProject/gitops/demo/KARGO_ARCHITECTURE_DEMO_SLIDES.md';
const output = '/home/esudbat/KubernetesDeviationProject/gitops/demo/KARGO_ARCHITECTURE_DEMO_SLIDES.pptx';

let md = fs.readFileSync(input, 'utf8');
if (md.startsWith('---')) {
  const end = md.indexOf('\n---', 3);
  if (end !== -1) md = md.slice(end + 4);
}
const rawSlides = md.split(/\n---\n/g).map((s) => s.trim()).filter(Boolean);

const pptx = new PptxGenJS();
pptx.layout = 'LAYOUT_WIDE';
pptx.author = 'KubernetesDeviation Project';
pptx.subject = 'Kargo Demo';
pptx.title = 'Kargo GitOps Promotion Demo';
pptx.company = 'KubernetesDeviation';
pptx.theme = { headFontFace: 'Aptos Display', bodyFontFace: 'Aptos', lang: 'en-US' };

function addHeader(slide, title, idx) {
  slide.background = { color: 'F8FAFC' };
  slide.addShape(pptx.ShapeType.rect, {
    x: 0,
    y: 0,
    w: 13.333,
    h: 0.9,
    fill: { color: '0F172A' },
    line: { color: '0F172A' },
  });
  slide.addText(title, {
    x: 0.5,
    y: 0.18,
    w: 12.4,
    h: 0.5,
    fontFace: 'Aptos Display',
    fontSize: 24,
    bold: true,
    color: 'FFFFFF',
  });
  slide.addText('Kargo GitOps Demo', {
    x: 0.5,
    y: 7.1,
    w: 4,
    h: 0.3,
    fontFace: 'Aptos',
    fontSize: 10,
    color: '64748B',
  });
  slide.addText(String(idx + 1), {
    x: 12.4,
    y: 7.1,
    w: 0.4,
    h: 0.3,
    align: 'right',
    fontFace: 'Aptos',
    fontSize: 10,
    color: '64748B',
  });
}

function parseSlide(content) {
  const lines = content.split('\n').map((l) => l.trimRight());
  let title = '';
  const body = [];
  for (const line of lines) {
    if (!title && line.startsWith('# ')) {
      title = line.replace(/^#\s+/, '').trim();
      continue;
    }
    if (line.startsWith('```')) continue;
    if (line.trim() === '') {
      body.push('');
      continue;
    }
    if (/^[-*]\s+/.test(line)) {
      body.push('• ' + line.replace(/^[-*]\s+/, '').trim());
    } else {
      body.push(line);
    }
  }
  if (!title) title = 'Slide';
  return { title, body };
}

function addArrow(slide, x, y, w, h) {
  slide.addShape(pptx.ShapeType.chevron, {
    x,
    y,
    w,
    h,
    fill: { color: '94A3B8' },
    line: { color: '94A3B8' },
  });
}

function addNode(slide, x, y, w, h, text, fill) {
  slide.addShape(pptx.ShapeType.roundRect, {
    x,
    y,
    w,
    h,
    fill: { color: fill },
    line: { color: '1E293B', pt: 1.2 },
    radius: 0.08,
  });
  slide.addText(text, {
    x: x + 0.08,
    y: y + 0.12,
    w: w - 0.16,
    h: h - 0.2,
    align: 'center',
    valign: 'mid',
    fontFace: 'Aptos',
    fontSize: 13,
    bold: true,
    color: '0F172A',
  });
}

function addArchitectureDiagramSlide(slide, idx) {
  addHeader(slide, 'Architecture Overview', idx);

  addNode(slide, 0.7, 1.5, 2.2, 1.0, 'GitOps Repo', 'DBEAFE');
  addNode(slide, 3.3, 1.5, 2.2, 1.0, 'Argo CD', 'E0E7FF');
  addArrow(slide, 2.95, 1.85, 0.3, 0.3);

  addNode(slide, 0.7, 3.2, 2.8, 1.0, 'Artifact Source\npublic.ecr.aws/nginx', 'DCFCE7');
  addNode(slide, 4.0, 3.2, 2.2, 1.0, 'Warehouse', 'FEF3C7');
  addNode(slide, 6.6, 3.2, 2.2, 1.0, 'Freight', 'FDE68A');
  addArrow(slide, 3.65, 3.55, 0.3, 0.3);
  addArrow(slide, 6.25, 3.55, 0.3, 0.3);

  addNode(slide, 2.4, 5.0, 2.0, 0.9, 'Stage: dev', 'CFFAFE');
  addNode(slide, 5.0, 5.0, 2.2, 0.9, 'Stage: staging', 'BAE6FD');
  addNode(slide, 7.8, 5.0, 2.4, 0.9, 'Stage: production', '93C5FD');
  addArrow(slide, 4.6, 5.3, 0.3, 0.3);
  addArrow(slide, 7.45, 5.3, 0.3, 0.3);

  addArrow(slide, 3.45, 2.65, 0.3, 0.3);
  addArrow(slide, 6.45, 4.35, 0.3, 0.3);

  slide.addText('Argo CD continuously syncs desired state from Git.\nKargo discovers artifacts as Freight and promotes across stages.', {
    x: 0.8,
    y: 6.2,
    w: 11.7,
    h: 0.7,
    fontFace: 'Aptos',
    fontSize: 12,
    color: '334155',
  });
}

function addTwoColumnUseCaseSlide(slide, idx, title, body) {
  addHeader(slide, title, idx);

  // body has one line "Application Level | Cluster Level" then "- left | right" rows
  const rows = body.filter((l) => l.trim() !== '');
  const left = [];
  const right = [];
  let leftHeader = 'Application Level';
  let rightHeader = 'Cluster Level';

  rows.forEach((line, i) => {
    const clean = line.replace(/^•\s*/, '');
    const parts = clean.split('|').map((p) => p.trim());
    if (i === 0 && !clean.startsWith('-')) {
      leftHeader = parts[0] || leftHeader;
      rightHeader = parts[1] || rightHeader;
      return;
    }
    if (parts[0]) left.push('• ' + parts[0].replace(/^-\s*/, ''));
    if (parts[1]) right.push('• ' + parts[1]);
  });

  slide.addShape(pptx.ShapeType.roundRect, {
    x: 0.6,
    y: 1.15,
    w: 5.9,
    h: 5.7,
    fill: { color: 'EFF6FF' },
    line: { color: '1D4ED8', pt: 1 },
    radius: 0.05,
  });
  slide.addShape(pptx.ShapeType.roundRect, {
    x: 6.8,
    y: 1.15,
    w: 5.9,
    h: 5.7,
    fill: { color: 'ECFDF5' },
    line: { color: '047857', pt: 1 },
    radius: 0.05,
  });

  slide.addText(leftHeader, {
    x: 0.8,
    y: 1.3,
    w: 5.5,
    h: 0.5,
    fontFace: 'Aptos Display',
    fontSize: 18,
    bold: true,
    color: '1D4ED8',
  });
  slide.addText(rightHeader, {
    x: 7.0,
    y: 1.3,
    w: 5.5,
    h: 0.5,
    fontFace: 'Aptos Display',
    fontSize: 18,
    bold: true,
    color: '047857',
  });

  slide.addText(left.join('\n'), {
    x: 0.8,
    y: 1.9,
    w: 5.5,
    h: 4.8,
    fontFace: 'Aptos',
    fontSize: 14,
    color: '0B1220',
    valign: 'top',
    breakLine: true,
  });
  slide.addText(right.join('\n'), {
    x: 7.0,
    y: 1.9,
    w: 5.5,
    h: 4.8,
    fontFace: 'Aptos',
    fontSize: 14,
    color: '0B1220',
    valign: 'top',
    breakLine: true,
  });
}

rawSlides.forEach((s, i) => {
  const { title, body } = parseSlide(s);
  const slide = pptx.addSlide();

  if (title.toLowerCase() === 'architecture overview') {
    addArchitectureDiagramSlide(slide, i);
    return;
  }

  if (title.toLowerCase() === 'additional kargo use cases') {
    addTwoColumnUseCaseSlide(slide, i, title, body);
    return;
  }

  if (title.toLowerCase().startsWith('aon onboarding')) {
    addHeader(slide, title, i);
    slide.addText(body.join('\n'), {
      x: 0.5,
      y: 1.05,
      w: 12.4,
      h: 5.9,
      fontFace: 'Consolas',
      fontSize: 11,
      color: '0B1220',
      valign: 'top',
      breakLine: true,
      margin: 2,
      fit: 'shrink',
      lineSpacingMultiple: 1.05,
    });
    return;
  }

  addHeader(slide, title, i);
  slide.addText(body.join('\n'), {
    x: 0.75,
    y: 1.15,
    w: 11.9,
    h: 5.7,
    fontFace: 'Aptos',
    fontSize: 18,
    color: '0B1220',
    valign: 'top',
    breakLine: true,
    margin: 4,
  });
});

pptx.writeFile({ fileName: output }).then(() => {
  console.log(`Wrote ${output} with ${rawSlides.length} slides.`);
}).catch((e) => {
  console.error(e);
  process.exit(1);
});
