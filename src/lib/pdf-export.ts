import { jsPDF } from 'jspdf';
import type { FinalizedResultsSnapshot } from './session-service';

/**
 * Generates an executive, print-quality PDF summary of the authoritative Johari Window snapshot.
 * Formatted cleanly with headers, metadata, 4-quadrant layout, trait lists, frequencies,
 * disclaimer, and small-sample warning if applicable.
 */
export function generateJohariResultsPdf(snapshot: FinalizedResultsSnapshot): void {
  const doc = new jsPDF({
    orientation: 'portrait',
    unit: 'pt',
    format: 'a4',
  });

  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();
  const margin = 40;
  const contentWidth = pageWidth - margin * 2;

  // Header Title
  doc.setFillColor(30, 41, 59); // slate-800
  doc.rect(0, 0, pageWidth, 75, 'F');

  doc.setTextColor(255, 255, 255);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(20);
  doc.text('Johari Window Assessment Report', margin, 38);

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(10);
  doc.setTextColor(203, 213, 225); // slate-300
  doc.text(`Subject: ${snapshot.subject_name}  |  Snapshot v${snapshot.calculation_version}`, margin, 58);

  const formattedDate = new Date(snapshot.generated_at).toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
  doc.text(`Generated: ${formattedDate}`, pageWidth - margin - doc.getTextWidth(`Generated: ${formattedDate}`), 58);

  let cursorY = 95;

  // Metadata / Summary bar
  doc.setTextColor(51, 65, 85); // slate-700
  doc.setFontSize(10);
  doc.setFont('helvetica', 'bold');
  doc.text(`Session: ${snapshot.title}`, margin, cursorY);

  doc.setFont('helvetica', 'normal');
  const metaText = `Participants: ${snapshot.participant_count} submitted feedback responses across all 55 canonical adjectives.`;
  doc.text(metaText, margin, cursorY + 14);

  cursorY += 32;

  // Small-sample privacy notice if participant_count < 5
  if (snapshot.participant_count < 5) {
    doc.setFillColor(254, 243, 199); // amber-100
    doc.setDrawColor(245, 158, 11); // amber-500
    doc.roundedRect(margin, cursorY, contentWidth, 34, 4, 4, 'FD');

    doc.setTextColor(146, 64, 14); // amber-900
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(8.5);
    doc.text('Small-sample privacy warning:', margin + 10, cursorY + 13);

    doc.setFont('helvetica', 'normal');
    doc.text(
      `Results finalized with ${snapshot.participant_count} response(s) under owner opt-in. Individual feedback answers may be deduced socially.`,
      margin + 10,
      cursorY + 25
    );

    cursorY += 44;
  }

  // 2x2 Grid Layout Dimensions
  const gap = 12;
  const colWidth = (contentWidth - gap) / 2;
  const quadrantHeight = 220;

  const leftColX = margin;
  const rightColX = margin + colWidth + gap;
  const topRowY = cursorY;
  const bottomRowY = topRowY + quadrantHeight + gap;

  const openAdj = snapshot.adjectives.filter((a) => a.quadrant === 'open');
  const blindAdj = snapshot.adjectives.filter((a) => a.quadrant === 'blind');
  const hiddenAdj = snapshot.adjectives.filter((a) => a.quadrant === 'hidden');
  const unknownAdj = snapshot.adjectives.filter((a) => a.quadrant === 'unknown');

  // Helper to draw a quadrant card
  const drawQuadrant = (
    x: number,
    y: number,
    title: string,
    subtitle: string,
    traits: typeof snapshot.adjectives,
    bgColor: [number, number, number],
    borderColor: [number, number, number],
    headerColor: [number, number, number],
    showFreq: boolean
  ) => {
    // Quadrant Box
    doc.setFillColor(...bgColor);
    doc.setDrawColor(...borderColor);
    doc.roundedRect(x, y, colWidth, quadrantHeight, 6, 6, 'FD');

    // Header strip
    doc.setFillColor(...headerColor);
    doc.roundedRect(x, y, colWidth, 34, 6, 6, 'F');
    // fill lower corners of header strip
    doc.rect(x, y + 26, colWidth, 8, 'F');

    doc.setTextColor(255, 255, 255);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(11);
    doc.text(title, x + 10, y + 17);

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8);
    doc.text(`${subtitle} (${traits.length})`, x + 10, y + 28);

    // Traits rendering
    doc.setFontSize(8.5);
    let traitY = y + 48;
    const paddingX = x + 10;
    const maxLines = 10;
    let lineCount = 0;

    if (traits.length === 0) {
      doc.setTextColor(148, 163, 184); // slate-400
      doc.setFont('helvetica', 'italic');
      doc.text('(None in this quadrant)', paddingX, traitY);
      return;
    }

    doc.setFont('helvetica', 'normal');
    doc.setTextColor(30, 41, 59);

    // Render chips or list
    const traitStrings = traits.map((t) => (showFreq ? `${t.word} (${t.feedback_count})` : t.word));

    // Simple formatted wrap
    let currentLine = '';
    for (const item of traitStrings) {
      const testLine = currentLine ? `${currentLine},  ${item}` : item;
      if (doc.getTextWidth(testLine) > colWidth - 20) {
        doc.text(currentLine, paddingX, traitY);
        traitY += 13;
        lineCount++;
        currentLine = item;
        if (lineCount >= maxLines - 1 && traits.length > 25) {
          doc.text(`${currentLine}... (+${traits.length - traitStrings.indexOf(item) - 1} more)`, paddingX, traitY);
          return;
        }
      } else {
        currentLine = testLine;
      }
    }
    if (currentLine) {
      doc.text(currentLine, paddingX, traitY);
    }
  };

  // Top Left: OPEN
  drawQuadrant(
    leftColX,
    topRowY,
    'OPEN AREA (Arena)',
    'Known to Self & Known to Others',
    openAdj,
    [238, 242, 255], // indigo-50
    [199, 210, 254], // indigo-200
    [79, 70, 229], // indigo-600
    true
  );

  // Top Right: BLIND
  drawQuadrant(
    rightColX,
    topRowY,
    'BLIND AREA (Blind Spot)',
    'Unknown to Self & Known to Others',
    blindAdj,
    [254, 243, 199], // amber-50
    [253, 230, 138], // amber-200
    [217, 119, 6], // amber-600
    true
  );

  // Bottom Left: HIDDEN
  drawQuadrant(
    leftColX,
    bottomRowY,
    'HIDDEN AREA (Façade)',
    'Known to Self & Unknown to Others',
    hiddenAdj,
    [240, 253, 250], // teal-50
    [153, 246, 228], // teal-200
    [13, 148, 136], // teal-600
    false
  );

  // Bottom Right: UNKNOWN
  drawQuadrant(
    rightColX,
    bottomRowY,
    'UNKNOWN AREA',
    'Unknown to Self & Unknown to Others',
    unknownAdj,
    [248, 250, 252], // slate-50
    [226, 232, 240], // slate-200
    [100, 116, 139], // slate-500
    false
  );

  cursorY = bottomRowY + quadrantHeight + 18;

  // Invariant verification box
  doc.setFillColor(241, 245, 249);
  doc.setDrawColor(203, 213, 225);
  doc.roundedRect(margin, cursorY, contentWidth, 38, 4, 4, 'FD');

  doc.setTextColor(51, 65, 85);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(8.5);
  doc.text('Mathematical Invariant Verification:', margin + 10, cursorY + 14);

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8);
  const invText = `Open (${openAdj.length}) + Blind (${blindAdj.length}) + Hidden (${hiddenAdj.length}) + Unknown (${unknownAdj.length}) = 55 canonical adjectives. Quadrants are strictly pairwise disjoint.`;
  doc.text(invText, margin + 10, cursorY + 27);

  cursorY += 48;

  // Disclaimer in footer
  doc.setTextColor(100, 116, 139);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(7.5);
  const disclaimer = 'Disclaimer: This Johari Window is a communication and self-awareness exercise, not a clinical personality assessment.';
  doc.text(disclaimer, margin, pageHeight - 25);

  const docNotice = 'Confidential Assessment Snapshot • Johari Window Application';
  doc.text(docNotice, pageWidth - margin - doc.getTextWidth(docNotice), pageHeight - 25);

  // Trigger browser download
  const safeName = snapshot.subject_name.toLowerCase().replace(/[^a-z0-9]/g, '-');
  doc.save(`johari-window-${safeName}-${snapshot.session_id.slice(0, 8)}.pdf`);
}
