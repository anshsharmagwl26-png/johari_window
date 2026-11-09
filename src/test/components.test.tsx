import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { AdjectiveChip } from '../components/common/AdjectiveChip';
import { SelectionCounter } from '../components/common/SelectionCounter';
import { StatusBadge } from '../components/common/StatusBadge';
import { ProgressBar } from '../components/common/ProgressBar';

describe('Design System Shared Components', () => {
  describe('AdjectiveChip', () => {
    it('renders with label and sets aria-pressed correctly when selected', () => {
      const handleToggle = vi.fn();
      const { rerender } = render(
        <AdjectiveChip
          id="brave"
          label="Brave"
          isSelected={false}
          onToggle={handleToggle}
        />
      );

      const button = screen.getByRole('button', { name: /Brave/i });
      expect(button).toBeDefined();
      expect(button.getAttribute('aria-pressed')).toBe('false');

      fireEvent.click(button);
      expect(handleToggle).toHaveBeenCalledWith('brave');

      rerender(
        <AdjectiveChip
          id="brave"
          label="Brave"
          isSelected={true}
          onToggle={handleToggle}
        />
      );
      expect(button.getAttribute('aria-pressed')).toBe('true');
    });

    it('disables button when disabled prop is passed', () => {
      const handleToggle = vi.fn();
      render(
        <AdjectiveChip
          id="calm"
          label="Calm"
          isSelected={false}
          disabled={true}
          onToggle={handleToggle}
        />
      );

      const button = screen.getByRole('button', { name: /Calm/i });
      expect((button as HTMLButtonElement).disabled).toBe(true);
      fireEvent.click(button);
      expect(handleToggle).not.toHaveBeenCalled();
    });
  });

  describe('SelectionCounter', () => {
    it('shows remaining count when below minimum of 5', () => {
      render(<SelectionCounter currentCount={3} min={5} max={7} />);
      expect(screen.getByText(/3 of 5–7 selected/i)).toBeDefined();
      expect(screen.getByText(/Need 2 more/i)).toBeDefined();
    });

    it('shows valid state when within 5–7 range', () => {
      render(<SelectionCounter currentCount={6} min={5} max={7} />);
      expect(screen.getByText(/6 of 5–7 selected/i)).toBeDefined();
      expect(screen.getByText(/Can select 1 more/i)).toBeDefined();
    });

    it('shows maximum reached when at 7', () => {
      render(<SelectionCounter currentCount={7} min={5} max={7} />);
      expect(screen.getByText(/7 of 5–7 selected/i)).toBeDefined();
      expect(screen.getByText(/Maximum reached/i)).toBeDefined();
    });
  });

  describe('StatusBadge', () => {
    it('renders draft status with label', () => {
      render(<StatusBadge status="draft" />);
      expect(screen.getByText('Draft')).toBeDefined();
    });

    it('renders open status with label', () => {
      render(<StatusBadge status="open" />);
      expect(screen.getByText('Collecting Feedback')).toBeDefined();
    });

    it('renders finalized status with label', () => {
      render(<StatusBadge status="finalized" />);
      expect(screen.getByText('Finalized')).toBeDefined();
    });
  });

  describe('ProgressBar', () => {
    it('renders accessible progressbar with percentage', () => {
      render(<ProgressBar value={3} max={6} label="Completion" />);
      const bar = screen.getByRole('progressbar');
      expect(bar.getAttribute('aria-valuenow')).toBe('3');
      expect(bar.getAttribute('aria-valuemax')).toBe('6');
      expect(screen.getByText(/50% \(3\/6\)/i)).toBeDefined();
    });
  });
});
