# Johari Window

A collaborative web application based on the **Johari Window psychological framework**, designed to help individuals explore self-awareness through self-assessment and peer feedback.

## Overview

The application allows users to create assessment sessions, select personal attributes, invite peers to provide feedback, and visualize the results through an interactive four-quadrant Johari Window.

## Features

- **Self-Assessment:** Select 5–7 adjectives that describe yourself.
- **Peer Feedback:** Invite others through secure, single-use invitation links.
- **Four-Quadrant Visualization:** Explore Open, Blind, Hidden, and Unknown characteristics.
- **Feedback Frequency:** View how frequently peers selected individual attributes.
- **Privacy Controls:** Anonymous feedback, owner-isolated results, and minimum response thresholds.
- **PDF Export:** Generate downloadable reports of finalized assessments.
- **Session Management:** Create sessions and manage invitations.

## The Johari Window

The application uses a canonical vocabulary of 55 adjectives and divides them into four quadrants:

| Quadrant | Description |
|---|---|
| Open | Known to yourself and others |
| Blind | Known to others but unknown to yourself |
| Hidden | Known to yourself but unknown to others |
| Unknown | Unknown to both yourself and others |

Quadrant classification follows set-based calculations, ensuring every adjective belongs to exactly one quadrant.

## Technology Stack

**Frontend:** React 19, TypeScript, Vite, Tailwind CSS

**Backend:** Node.js, Express

**Database & Authentication:** PostgreSQL, Supabase, Row Level Security

**Testing:** Vitest, PostgreSQL pgTAP

**PDF Generation:** jsPDF

## Security & Privacy

- Cryptographically generated single-use invitation tokens.
- SHA-256 token hashing and atomic token consumption.
- PostgreSQL Row Level Security.
- Owner-authorized access to assessment results.
- Minimum participant threshold to protect respondent privacy.
- Anonymous feedback without individually attributable trait selections.

## Project Scope

This application is designed as an educational and self-reflection tool based on the Johari Window framework. It is not a clinical or psychological diagnostic instrument.

---

**Built with React, TypeScript, Node.js, PostgreSQL, and Supabase.**
