# OM Intelligence - Phase 1 MVP Frontend

AI-powered document analysis system for real estate due diligence. Built with Next.js 14, React, TypeScript, and Tailwind CSS.

## Features

### 1. Document Upload Interface
- Drag-and-drop file upload zone
- Progress indicators during upload
- Support for PDFs, spreadsheets (CSV/XLSX), and images
- File size and type validation
- Recent document list with status indicators

### 2. Document Viewer
- PDF preview with page navigation
- Zoom controls (50% - 200%)
- Side panel with extracted data:
  - Key metrics (Purchase Price, NOI, Cap Rate)
  - Property details (address, units, year built)
  - Financial projections table
- Annotations and notes panel
- Toggleable side panel for full-screen viewing

### 3. Analysis Dashboard
- **Overall Deal Score**: 0-10 rating with qualitative assessment
- **Summary Cards**:
  - Purchase Price
  - NOI (with trend indicators)
  - Cap Rate (vs market comparison)
  - Cash on Cash return
  - GRM (Gross Rent Multiplier)
  - Projected IRR
- **Property Details**:
  - Units, Year Built, Square Footage
  - Property Class badge
- **Red Flags & Warnings**:
  - Critical, Warning, and Info level flags
  - Expandable list with show more/less
  - Color-coded severity indicators

### 4. Q&A Chat Interface
- Natural language query interface
- Suggested question chips
- Source citations with page numbers
- Chat history with timestamps
- Loading indicators during processing
- Quick-access source links

### 5. Export Options
- PDF Report generation
- Notion sync integration (UI ready)
- One-click export buttons in analysis header

## Tech Stack

- **Framework**: Next.js 14 (App Router)
- **Language**: TypeScript
- **Styling**: Tailwind CSS + shadcn/ui components
- **State**: React hooks (useState, useEffect)
- **Icons**: Lucide React
- **Toast Notifications**: Radix UI Toast

## Getting Started

### Prerequisites
- Node.js 18+
- npm or yarn

### Installation

```bash
# Install dependencies
npm install

# Run development server
npm run dev

# Build for production
npm run build
```

### Development Server

The development server runs on `http://localhost:3000`

```bash
npm run dev
```

## Project Structure

```
projects/om-intelligence/
├── src/
│   ├── app/                    # Next.js app router
│   │   ├── globals.css         # Global styles + Tailwind
│   │   ├── layout.tsx          # Root layout with providers
│   │   └── page.tsx            # Main dashboard page
│   ├── components/
│   │   ├── analysis/
│   │   │   ├── dashboard.tsx   # Analysis dashboard component
│   │   │   └── document-viewer.tsx  # PDF viewer with side panel
│   │   ├── chat/
│   │   │   └── chat-interface.tsx   # Q&A chat component
│   │   ├── ui/                 # shadcn/ui components
│   │   │   ├── button.tsx
│   │   │   ├── toast.tsx
│   │   │   └── toaster.tsx
│   │   ├── upload/
│   │   │   ├── document-list.tsx    # Document list component
│   │   │   └── upload-zone.tsx      # Drag-drop upload zone
│   │   ├── views/
│   │   │   └── document-upload-view.tsx  # Main view container
│   │   └── theme-provider.tsx   # Theme context provider
│   ├── hooks/
│   │   └── use-toast.ts        # Toast notification hook
│   ├── lib/
│   │   └── utils.ts            # Utility functions (cn, formatters)
│   └── types/
│       └── index.ts            # TypeScript type definitions
├── public/                     # Static assets
├── next.config.js             # Next.js configuration
├── tailwind.config.js         # Tailwind CSS configuration
└── package.json               # Dependencies
```

## Design System

### Colors
- Primary: Blue (#2563eb)
- Success: Green (#22c55e)
- Warning: Amber (#f59e0b)
- Danger: Red (#ef4444)
- Background: Gray-50 to white gradient

### Typography
- Font: Inter (Google Fonts)
- Headings: font-bold
- Body: text-gray-600/700
- Small text: text-xs text-gray-500

### Spacing
- Cards: p-5 or p-6
- Buttons: px-4 py-2 (sm) / px-6 py-3 (default)
- Grid gaps: gap-4 or gap-6

### Components
- Rounded corners: rounded-xl (cards), rounded-lg (buttons)
- Shadows: shadow-sm (default), shadow-md (hover)
- Borders: border border-gray-200

## Mock Data

The Phase 1 MVP uses mock data for demonstration:
- Sunset Gardens apartment complex (48 units, 1985)
- $12.5M purchase price
- 7.0% cap rate
- 7.2/10 deal score

## Next Steps (Phase 2)

1. **Backend Integration**
   - API routes for document upload
   - PDF processing with OCR
   - AI analysis with Claude/GPT-4
   - Database storage (PostgreSQL)

2. **Advanced Features**
   - Real PDF rendering (react-pdf)
   - Live chat with streaming responses
   - Notion OAuth integration
   - Email notifications

3. **Authentication**
   - NextAuth.js integration
   - User accounts and document ownership

## License

Private - Moxie Management / DJA CO
