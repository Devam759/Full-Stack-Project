import React, { useState } from 'react';
import {
  Search,
  Calendar,
  MapPin,
  ArrowRight,
  Shield,
  Sparkles,
  ChevronDown,
  ChevronUp,
  Camera,
  Tent,
  Wrench,
  Gamepad2,
  Headphones,
  BookOpen,
  CheckCircle2,
  QrCode,
  Users,
  Smartphone,
} from 'lucide-react';

export function OnboardingScreen({ onNavigate }) {
  const [activeTab, setActiveTab] = useState('borrow'); // 'borrow', 'lend', 'communities'
  const [pickupLocation, setPickupLocation] = useState('IIT Delhi Campus, Hauz Khas');
  const [itemQuery, setItemQuery] = useState('');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [openFaq, setOpenFaq] = useState(null);

  const toggleFaq = (index) => {
    setOpenFaq(openFaq === index ? null : index);
  };

  const handleSearchSubmit = (e) => {
    e?.preventDefault();
    onNavigate('items');
  };

  const categories = [
    {
      id: 'electronics_and_gadgets',
      title: 'Cameras & Creators',
      desc: 'DSLRs, 4K lenses, ring lights & microphones',
      image:
        'https://images.unsplash.com/photo-1516035069371-29a1b244cc32?auto=format&fit=crop&w=600&q=80',
      icon: Camera,
    },
    {
      id: 'outdoor_and_camping',
      title: 'Outdoor & Camping',
      desc: 'Waterproof dome tents, sleeping bags & stoves',
      image:
        'https://images.unsplash.com/photo-1504280390367-361c6d9f38f4?auto=format&fit=crop&w=600&q=80',
      icon: Tent,
    },
    {
      id: 'tools_and_diy',
      title: 'Tools & DIY Hardware',
      desc: 'Cordless power drills, socket sets & ladders',
      image:
        'https://images.unsplash.com/photo-1504148455328-c376907d081c?auto=format&fit=crop&w=600&q=80',
      icon: Wrench,
    },
    {
      id: 'board_games_and_hobbies',
      title: 'Gaming & Consoles',
      desc: 'Nintendo Switch, controllers & party games',
      image:
        'https://images.unsplash.com/photo-1578303512597-81e6cc155b3e?auto=format&fit=crop&w=600&q=80',
      icon: Gamepad2,
    },
    {
      id: 'musical_instruments',
      title: 'Audio & Music',
      desc: 'Noise-cancelling headphones & guitars',
      image:
        'https://images.unsplash.com/photo-1546435770-a3e426bf472b?auto=format&fit=crop&w=600&q=80',
      icon: Headphones,
    },
    {
      id: 'books_and_study',
      title: 'Academic & Lab Gear',
      desc: 'Engineering tools, textbooks & graphing gear',
      image:
        'https://images.unsplash.com/photo-1497633762265-9d179a990aa6?auto=format&fit=crop&w=600&q=80',
      icon: BookOpen,
    },
  ];

  const faqs = [
    {
      q: 'How does the security deposit work?',
      a: 'When you request a booking, the required deposit is locked into zero-risk escrow inside our double-entry ledger. Your money is never directly transferred to the lender; it remains safely frozen until return handover is completed and verified via QR code.',
    },
    {
      q: 'How do pickup and return QR codes protect me?',
      a: 'Both parties meet in person and scan a dynamic, cryptographic QR code. This timestamped handover verifies item condition and starts or stops the rental clock atomically, completely eliminating "he said, she said" disputes.',
    },
    {
      q: 'What is Demo Money?',
      a: 'BorrowLoop is currently running in demonstration mode for the CS1237 Semester Project. Every user receives a pre-credited demo wallet balance to simulate real escrow, penalties, and double-entry accounting without risking real funds.',
    },
    {
      q: 'Can I earn rent by lending my own idle equipment?',
      a: 'Yes! Simply sign up, select your campus or neighborhood community, and list your item with photos, daily rent, and deposit. Once approved, members can book your gear and you earn 90% of the daily rental rate.',
    },
    {
      q: 'What happens if an item is returned damaged or late?',
      a: 'If an item is returned late, automated late fees are deducted from the escrow deposit. If condition issues arise, either party can freeze the deposit and file a dispute with photos for our Care Team to review and resolve.',
    },
  ];

  return (
    <div className="w-full bg-white text-slate-900 font-sans">
      {/* 1. HERO SECTION (Uber 2-column layout) */}
      <section className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 pt-8 pb-14">
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 lg:gap-12 items-center">
          {/* Left Column: Mode Tabs & Booking Search Card */}
          <div className="lg:col-span-6 space-y-6">
            {/* Mode Selector Tabs */}
            <div className="inline-flex items-center gap-1 p-1 bg-neutral-100 rounded-full border border-neutral-200">
              <button
                type="button"
                onClick={() => setActiveTab('borrow')}
                className={`flex items-center gap-2 px-5 py-2 rounded-full text-xs font-bold transition ${
                  activeTab === 'borrow'
                    ? 'bg-black text-white shadow-xs'
                    : 'text-neutral-600 hover:text-black'
                }`}
              >
                <Search className="w-3.5 h-3.5" />
                <span>Borrow gear</span>
              </button>
              <button
                type="button"
                onClick={() => setActiveTab('lend')}
                className={`flex items-center gap-2 px-5 py-2 rounded-full text-xs font-bold transition ${
                  activeTab === 'lend'
                    ? 'bg-black text-white shadow-xs'
                    : 'text-neutral-600 hover:text-black'
                }`}
              >
                <Sparkles className="w-3.5 h-3.5" />
                <span>Lend & earn</span>
              </button>
              <button
                type="button"
                onClick={() => onNavigate('communities')}
                className="flex items-center gap-2 px-5 py-2 rounded-full text-xs font-bold text-neutral-600 hover:text-black transition"
              >
                <Users className="w-3.5 h-3.5" />
                <span>Communities</span>
              </button>
            </div>

            {/* Display Headline */}
            <div>
              <h1 className="text-4xl sm:text-5xl font-extrabold tracking-tight text-black leading-tight">
                {activeTab === 'borrow'
                  ? 'Borrow anything in your community'
                  : 'Monetize your idle equipment safely'}
              </h1>
              <p className="mt-3 text-base text-neutral-600 font-normal leading-relaxed">
                {activeTab === 'borrow'
                  ? 'Access high-value cameras, camping gear, and power tools from verified neighbors. Secured with escrow deposits and QR handovers.'
                  : 'Earn passive income from tools and electronics sitting in your closet, backed by guaranteed security deposits and verified student IDs.'}
              </p>
            </div>

            {/* Uber Search Card */}
            <form
              onSubmit={handleSearchSubmit}
              className="bg-white rounded-2xl border border-neutral-200 shadow-sm p-5 space-y-3"
            >
              {/* Location Input */}
              <div className="relative flex items-center">
                <div className="absolute left-3.5 text-neutral-500">
                  <MapPin className="w-4 h-4 text-neutral-700" />
                </div>
                <input
                  type="text"
                  value={pickupLocation}
                  onChange={(e) => setPickupLocation(e.target.value)}
                  placeholder="Pickup location or campus"
                  className="w-full pl-10 pr-4 py-3 bg-neutral-50 hover:bg-neutral-100/70 focus:bg-white text-sm font-medium text-black rounded-xl border border-neutral-200 outline-none focus:border-black transition"
                />
              </div>

              {/* Item Query Input */}
              <div className="relative flex items-center">
                <div className="absolute left-3.5 text-neutral-500">
                  <Search className="w-4 h-4 text-neutral-700" />
                </div>
                <input
                  type="text"
                  value={itemQuery}
                  onChange={(e) => setItemQuery(e.target.value)}
                  placeholder="What item do you need? (e.g. Sony A7, Camping tent, Drill)"
                  className="w-full pl-10 pr-4 py-3 bg-neutral-50 hover:bg-neutral-100/70 focus:bg-white text-sm font-medium text-black rounded-xl border border-neutral-200 outline-none focus:border-black transition"
                />
              </div>

              {/* Date Range Inputs */}
              <div className="grid grid-cols-2 gap-3">
                <div className="relative flex items-center">
                  <div className="absolute left-3 text-neutral-500">
                    <Calendar className="w-3.5 h-3.5 text-neutral-700" />
                  </div>
                  <input
                    type="date"
                    value={startDate}
                    onChange={(e) => setStartDate(e.target.value)}
                    className="w-full pl-9 pr-2 py-2.5 bg-neutral-50 text-xs font-medium text-neutral-800 rounded-xl border border-neutral-200 outline-none focus:border-black transition"
                  />
                </div>
                <div className="relative flex items-center">
                  <div className="absolute left-3 text-neutral-500">
                    <Calendar className="w-3.5 h-3.5 text-neutral-700" />
                  </div>
                  <input
                    type="date"
                    value={endDate}
                    onChange={(e) => setEndDate(e.target.value)}
                    className="w-full pl-9 pr-2 py-2.5 bg-neutral-50 text-xs font-medium text-neutral-800 rounded-xl border border-neutral-200 outline-none focus:border-black transition"
                  />
                </div>
              </div>

              {/* Main Call to Action Button */}
              <div className="pt-2 flex items-center gap-3">
                <button
                  type="submit"
                  className="w-full py-3.5 px-6 bg-black hover:bg-neutral-800 active:scale-[0.99] text-white font-bold text-sm rounded-xl transition flex items-center justify-center gap-2 shadow-sm"
                >
                  <span>{activeTab === 'borrow' ? 'See available items' : 'List an item now'}</span>
                  <ArrowRight className="w-4 h-4" />
                </button>
              </div>
            </form>
          </div>

          {/* Right Column: Hero Visual Artwork */}
          <div className="lg:col-span-6 relative">
            <div className="relative rounded-3xl overflow-hidden shadow-xl aspect-4/3 border border-neutral-200 bg-neutral-100">
              <img
                src="https://images.unsplash.com/photo-1522202176988-66273c2fd55f?auto=format&fit=crop&w=1200&q=80"
                alt="Community members collaborating and sharing equipment"
                className="w-full h-full object-cover"
              />
              <div className="absolute inset-0 bg-gradient-to-t from-black/60 via-transparent to-transparent flex items-end p-6">
                <div className="text-white space-y-1">
                  <div className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-white/20 backdrop-blur-md text-white text-xs font-semibold">
                    <Shield className="w-3 h-3 text-teal-300" />
                    <span>Protected Peer Escrow</span>
                  </div>
                  <h3 className="text-xl font-bold text-white">Join 1,200+ campus peers</h3>
                  <p className="text-xs text-neutral-200">
                    Share cameras, tools, and sports gear with zero deposit risk.
                  </p>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* 2. DEMO MONEY BANNER (Uber promo notification strip) */}
      <section className="bg-amber-500 text-black py-3 px-4 font-medium text-xs">
        <div className="max-w-7xl mx-auto flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <span className="px-2 py-0.5 bg-black text-amber-300 rounded font-bold uppercase tracking-wider text-[10px]">
              Demo Mode
            </span>
            <span>
              Pre-credited simulation wallet active. Explore double-entry ledger transactions and
              escrow safely.
            </span>
          </div>
          <button
            type="button"
            onClick={() => onNavigate('items')}
            className="underline font-bold hover:text-white transition"
          >
            Browse all items &rarr;
          </button>
        </div>
      </section>

      {/* 3. "EXPLORE WHAT YOU CAN BORROW" (Uber 6-Card Category Grid) */}
      <section className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-16">
        <div className="space-y-2 mb-8">
          <h2 className="text-2xl sm:text-3xl font-extrabold text-black tracking-tight">
            Explore what you can borrow with BorrowLoop
          </h2>
          <p className="text-sm text-neutral-500">
            High-utility gear available on-demand from verified members in your area
          </p>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
          {categories.map((cat) => {
            const Icon = cat.icon;
            return (
              <div
                key={cat.id}
                onClick={() => onNavigate('items')}
                className="group cursor-pointer bg-neutral-50 hover:bg-neutral-100/80 rounded-2xl p-5 border border-neutral-200 transition duration-200 flex flex-col justify-between space-y-4"
              >
                <div className="space-y-1">
                  <div className="flex items-center justify-between">
                    <span className="font-bold text-base text-black group-hover:text-teal-700 transition">
                      {cat.title}
                    </span>
                    <Icon className="w-5 h-5 text-neutral-500 group-hover:text-teal-600 transition" />
                  </div>
                  <p className="text-xs text-neutral-500 leading-relaxed">{cat.desc}</p>
                </div>

                <div className="h-36 rounded-xl overflow-hidden bg-neutral-200">
                  <img
                    src={cat.image}
                    alt={cat.title}
                    className="w-full h-full object-cover group-hover:scale-105 transition duration-300"
                  />
                </div>

                <div className="pt-1 flex items-center justify-between text-xs font-bold text-black group-hover:underline">
                  <span>View items</span>
                  <ArrowRight className="w-4 h-4 group-hover:translate-x-1 transition" />
                </div>
              </div>
            );
          })}
        </div>
      </section>

      {/* 4. "PLAN FOR LATER" (Uber Reserve Split Feature Card) */}
      <section className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 pb-16">
        <div className="bg-[#eef8f5] border border-[#cbebe1] rounded-3xl p-8 sm:p-12">
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-center">
            {/* Left side */}
            <div className="lg:col-span-7 space-y-5">
              <span className="px-3 py-1 bg-teal-100 text-teal-800 rounded-full font-bold text-xs uppercase tracking-wider">
                Plan ahead
              </span>
              <h2 className="text-3xl sm:text-4xl font-extrabold text-slate-900 tracking-tight">
                Get your gear locked with BorrowLoop Reserve
              </h2>
              <p className="text-sm text-slate-700 leading-relaxed max-w-lg">
                Planning a shoot, camping trip, or home renovation? Lock dates up to 30 days ahead
                with guaranteed calendar availability and zero charge until pickup.
              </p>

              {/* Quick Reserve Action */}
              <div className="pt-2 flex flex-wrap items-center gap-3">
                <button
                  type="button"
                  onClick={() => onNavigate('items')}
                  className="px-6 py-3 bg-black hover:bg-neutral-800 text-white font-bold text-xs rounded-full transition flex items-center gap-2"
                >
                  <span>Reserve an item</span>
                  <ArrowRight className="w-3.5 h-3.5" />
                </button>
                <span className="text-xs text-slate-500 font-medium">
                  Free cancellation up to 6 hours before
                </span>
              </div>
            </div>

            {/* Right side bullets */}
            <div className="lg:col-span-5 bg-white/80 backdrop-blur-xs rounded-2xl p-6 border border-teal-100 space-y-4">
              <div className="flex items-start gap-3">
                <CheckCircle2 className="w-5 h-5 text-teal-600 shrink-0 mt-0.5" />
                <div>
                  <h4 className="text-sm font-bold text-slate-900">Atomic Date Lock</h4>
                  <p className="text-xs text-slate-600">
                    No double-booking conflicts. Dates are locked in MongoDB ACID transactions.
                  </p>
                </div>
              </div>

              <div className="flex items-start gap-3">
                <CheckCircle2 className="w-5 h-5 text-teal-600 shrink-0 mt-0.5" />
                <div>
                  <h4 className="text-sm font-bold text-slate-900">Protected Escrow</h4>
                  <p className="text-xs text-slate-600">
                    Deposit stays frozen in double-entry ledger until you confirm pickup condition.
                  </p>
                </div>
              </div>

              <div className="flex items-start gap-3">
                <CheckCircle2 className="w-5 h-5 text-teal-600 shrink-0 mt-0.5" />
                <div>
                  <h4 className="text-sm font-bold text-slate-900">Automatic Return Settlement</h4>
                  <p className="text-xs text-slate-600">
                    Instant deposit refund to your wallet as soon as return QR is scanned.
                  </p>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* 5. DARK CONTRAST SECTION (Matching "Uber One" Spotlight) */}
      <section className="bg-black text-white py-16 px-4 sm:px-6 lg:px-8">
        <div className="max-w-7xl mx-auto grid grid-cols-1 lg:grid-cols-12 gap-8 items-center">
          <div className="lg:col-span-8 space-y-4">
            <span className="px-3 py-1 bg-neutral-800 text-teal-400 border border-neutral-700 rounded-full font-bold text-xs uppercase tracking-wider">
              Community Trust & Safety
            </span>
            <h2 className="text-3xl sm:text-4xl font-extrabold tracking-tight">
              Zero-deposit risk with mathematically verified escrow
            </h2>
            <p className="text-sm text-neutral-400 max-w-xl leading-relaxed">
              Every transaction is journaled in an append-only double-entry ledger. Lenders receive
              automated compensation for damage, borrowers enjoy dispute mediation with photo
              evidence, and both sides build trust scores.
            </p>
            <div className="pt-2 flex items-center gap-4">
              <button
                type="button"
                onClick={() => onNavigate('communities')}
                className="px-6 py-3 bg-white hover:bg-neutral-100 text-black font-bold text-xs rounded-full transition"
              >
                Join a community
              </button>
              <button
                type="button"
                onClick={() => onNavigate('signup')}
                className="px-6 py-3 bg-neutral-800 hover:bg-neutral-700 text-white font-bold text-xs rounded-full transition border border-neutral-700"
              >
                Sign up free
              </button>
            </div>
          </div>

          <div className="lg:col-span-4 flex justify-center">
            <div className="p-8 rounded-3xl bg-neutral-900 border border-neutral-800 text-center space-y-4 w-full max-w-sm">
              <Shield className="w-12 h-12 text-teal-400 mx-auto" />
              <div className="text-2xl font-bold text-white">100% Escrow Protected</div>
              <p className="text-xs text-neutral-400">
                Backed by real-time MongoDB transactions and cryptographic two-sided QR
                verification.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* 6. "BORROW WITH FRIENDS SEAMLESSLY" (Split Feature) */}
      <section className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-16">
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-12 items-center">
          {/* Left: Graphic Mockup */}
          <div className="lg:col-span-6 bg-neutral-50 rounded-3xl p-8 border border-neutral-200">
            <div className="bg-white rounded-2xl border border-neutral-200 shadow-sm p-6 space-y-4">
              <div className="flex items-center justify-between border-b border-neutral-100 pb-3">
                <div className="flex items-center gap-2">
                  <div className="w-2.5 h-2.5 rounded-full bg-emerald-500 animate-pulse" />
                  <span className="font-bold text-xs text-neutral-900">Live QR Handover</span>
                </div>
                <span className="text-[11px] font-mono text-neutral-500">REF #BL-8921</span>
              </div>

              <div className="flex items-center gap-4">
                <div className="p-3 bg-neutral-100 rounded-xl">
                  <QrCode className="w-14 h-14 text-neutral-800" />
                </div>
                <div className="space-y-1">
                  <div className="text-xs font-semibold text-neutral-900">
                    Sony Alpha A7 IV Mirrorless Camera
                  </div>
                  <div className="text-[11px] text-neutral-500">Scan pickup QR to release gear</div>
                  <span className="inline-block px-2 py-0.5 bg-emerald-100 text-emerald-800 rounded font-semibold text-[10px]">
                    Escrow Locked: ₹5,000.00
                  </span>
                </div>
              </div>

              <div className="pt-2 border-t border-neutral-100 flex items-center justify-between text-xs text-neutral-500">
                <span>Handover window: 24h</span>
                <span className="font-bold text-black">Condition: Like New</span>
              </div>
            </div>
          </div>

          {/* Right: Text explanation */}
          <div className="lg:col-span-6 space-y-4">
            <span className="px-3 py-1 bg-neutral-100 text-neutral-800 rounded-full font-bold text-xs uppercase tracking-wider">
              Seamless handovers
            </span>
            <h2 className="text-3xl sm:text-4xl font-extrabold text-black tracking-tight">
              Meet up, scan, and borrow with total confidence
            </h2>
            <p className="text-sm text-neutral-600 leading-relaxed">
              No awkward deposit negotiations. When you meet the lender, simply scan the dynamic QR
              code on their screen. Both apps update in real-time via Socket.IO, condition photos
              are stored on CDN, and the countdown begins.
            </p>
            <div className="pt-2">
              <button
                type="button"
                onClick={() => onNavigate('items')}
                className="text-xs font-bold text-black underline flex items-center gap-1 hover:text-teal-700 transition"
              >
                <span>Browse gear in IIT Delhi &rarr;</span>
              </button>
            </div>
          </div>
        </div>
      </section>

      {/* 7. THREE-CARD EDITORIAL GRID (Matching Uber 3-card photo grid) */}
      <section className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 pb-16">
        <div className="space-y-2 mb-8">
          <h2 className="text-2xl sm:text-3xl font-extrabold text-black tracking-tight">
            Use BorrowLoop to power your lifestyle
          </h2>
          <p className="text-sm text-neutral-500">
            Everyday sharing tailored to students, travelers, and makers
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          {/* Card 1 */}
          <div className="space-y-4">
            <div className="h-56 rounded-2xl overflow-hidden bg-neutral-100 border border-neutral-200">
              <img
                src="https://images.unsplash.com/photo-1523240795612-9a054b0db644?auto=format&fit=crop&w=800&q=80"
                alt="Campus student borrowing textbooks and lab kits"
                className="w-full h-full object-cover"
              />
            </div>
            <div className="space-y-2">
              <h3 className="font-bold text-lg text-black">Campus Student Life</h3>
              <p className="text-xs text-neutral-600 leading-relaxed">
                Save ₹15,000+ every semester. Borrow scientific calculators, DSLR cameras, and lab
                kits from peers right across your hostel corridor.
              </p>
              <button
                type="button"
                onClick={() => onNavigate('items')}
                className="pt-1 text-xs font-bold text-black hover:underline flex items-center gap-1"
              >
                <span>Browse campus items</span>
                <ArrowRight className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>

          {/* Card 2 */}
          <div className="space-y-4">
            <div className="h-56 rounded-2xl overflow-hidden bg-neutral-100 border border-neutral-200">
              <img
                src="https://images.unsplash.com/photo-1510312305653-8ed496efae75?auto=format&fit=crop&w=800&q=80"
                alt="Weekend camping and outdoor gear"
                className="w-full h-full object-cover"
              />
            </div>
            <div className="space-y-2">
              <h3 className="font-bold text-lg text-black">Weekend Expeditions</h3>
              <p className="text-xs text-neutral-600 leading-relaxed">
                Gear up for treks, road trips, and music festivals with 4-person waterproof tents,
                portable power stations, and GoPro action cameras.
              </p>
              <button
                type="button"
                onClick={() => onNavigate('items')}
                className="pt-1 text-xs font-bold text-black hover:underline flex items-center gap-1"
              >
                <span>Find outdoor gear</span>
                <ArrowRight className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>

          {/* Card 3 */}
          <div className="space-y-4">
            <div className="h-56 rounded-2xl overflow-hidden bg-neutral-100 border border-neutral-200">
              <img
                src="https://images.unsplash.com/photo-1581783342308-f792dbdd27c5?auto=format&fit=crop&w=800&q=80"
                alt="Tools and DIY home improvement"
                className="w-full h-full object-cover"
              />
            </div>
            <div className="space-y-2">
              <h3 className="font-bold text-lg text-black">Home & DIY Projects</h3>
              <p className="text-xs text-neutral-600 leading-relaxed">
                Fix furniture and mount shelves without buying heavy tools you only need once.
                Borrow cordless hammer drills and toolkits for a weekend.
              </p>
              <button
                type="button"
                onClick={() => onNavigate('items')}
                className="pt-1 text-xs font-bold text-black hover:underline flex items-center gap-1"
              >
                <span>Find DIY tools</span>
                <ArrowRight className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>
        </div>
      </section>

      {/* 8. "LOOKING FOR CAMPUS SOLUTIONS?" (Matching Uber for Business) */}
      <section className="bg-black text-white py-16 px-4 sm:px-6 lg:px-8">
        <div className="max-w-7xl mx-auto grid grid-cols-1 lg:grid-cols-12 gap-8 items-center">
          <div className="lg:col-span-7 space-y-4">
            <span className="px-3 py-1 bg-neutral-800 text-teal-400 border border-neutral-700 rounded-full font-bold text-xs uppercase tracking-wider">
              Institutions & Societies
            </span>
            <h2 className="text-3xl sm:text-4xl font-extrabold tracking-tight">
              Bring BorrowLoop to your college, society, or co-working hub
            </h2>
            <p className="text-sm text-neutral-400 max-w-xl leading-relaxed">
              Launch a branded private sharing circle with domain-restricted signups (@iitd.ac.in),
              automated trust scores, and zero platform maintenance overhead.
            </p>
            <div className="pt-2 flex items-center gap-4">
              <button
                type="button"
                onClick={() => onNavigate('communities')}
                className="px-6 py-3 bg-white hover:bg-neutral-100 text-black font-bold text-xs rounded-full transition"
              >
                Create a community
              </button>
            </div>
          </div>

          <div className="lg:col-span-5 rounded-2xl overflow-hidden border border-neutral-800 bg-neutral-900 p-6 space-y-3">
            <div className="text-sm font-bold text-white">Community Leader Features</div>
            <ul className="text-xs text-neutral-400 space-y-2">
              <li className="flex items-center gap-2">
                <CheckCircle2 className="w-4 h-4 text-teal-400" />
                <span>Custom member approval queues</span>
              </li>
              <li className="flex items-center gap-2">
                <CheckCircle2 className="w-4 h-4 text-teal-400" />
                <span>Private borrowing restricted to verified email domains</span>
              </li>
              <li className="flex items-center gap-2">
                <CheckCircle2 className="w-4 h-4 text-teal-400" />
                <span>Zero infrastructure or server management needed</span>
              </li>
            </ul>
          </div>
        </div>
      </section>

      {/* 9. FREQUENTLY ASKED QUESTIONS (Uber-style Accordion) */}
      <section className="max-w-4xl mx-auto px-4 sm:px-6 py-16 space-y-6">
        {/* Schema.org FAQPage JSON-LD for Google Rich Results */}
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{
            __html: JSON.stringify({
              '@context': 'https://schema.org',
              '@type': 'FAQPage',
              mainEntity: faqs.map((faq) => ({
                '@type': 'Question',
                name: faq.q,
                acceptedAnswer: {
                  '@type': 'Answer',
                  text: faq.a,
                },
              })),
            }),
          }}
        />

        <div className="text-center space-y-2 mb-8">
          <h2 className="text-3xl font-extrabold text-black tracking-tight">
            Frequently asked questions
          </h2>
          <p className="text-xs text-neutral-500">
            Everything you need to know about peer borrowing and escrow
          </p>
        </div>

        <div className="divide-y divide-neutral-200 border-y border-neutral-200">
          {faqs.map((faq, index) => (
            <div key={index} className="py-4">
              <button
                type="button"
                onClick={() => toggleFaq(index)}
                className="w-full flex items-center justify-between text-left font-bold text-base text-black hover:text-teal-700 transition"
              >
                <span>{faq.q}</span>
                {openFaq === index ? (
                  <ChevronUp className="w-5 h-5 text-neutral-500 shrink-0" />
                ) : (
                  <ChevronDown className="w-5 h-5 text-neutral-500 shrink-0" />
                )}
              </button>
              {openFaq === index && (
                <p className="mt-3 text-xs text-neutral-600 leading-relaxed pr-8">{faq.a}</p>
              )}
            </div>
          ))}
        </div>
      </section>

      {/* 10. "DO MORE IN THE APP" (PWA / Mobile Section) */}
      <section className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 pb-16">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <div className="bg-neutral-50 rounded-2xl p-6 border border-neutral-200 flex items-center gap-6">
            <div className="p-3 bg-white rounded-xl border border-neutral-200 shadow-xs">
              <QrCode className="w-16 h-16 text-black" />
            </div>
            <div className="space-y-1">
              <h3 className="font-bold text-base text-black">Scan to open on mobile</h3>
              <p className="text-xs text-neutral-500">
                Point your phone camera to experience mobile QR handovers and push alerts.
              </p>
            </div>
          </div>

          <div className="bg-neutral-50 rounded-2xl p-6 border border-neutral-200 flex items-center gap-6">
            <div className="p-3 bg-black text-white rounded-xl shadow-xs">
              <Smartphone className="w-16 h-16" />
            </div>
            <div className="space-y-1">
              <h3 className="font-bold text-base text-black">Install the BorrowLoop PWA</h3>
              <p className="text-xs text-neutral-500">
                Works offline, sends real-time booking updates, and provides instant camera access.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* 11. GLOBAL FOOTER (Uber pitch black footer) */}
      <footer className="bg-black text-white pt-16 pb-12 px-4 sm:px-6 lg:px-8">
        <div className="max-w-7xl mx-auto space-y-12">
          {/* Top Footer: Brand */}
          <div className="flex flex-wrap items-center justify-between gap-4 border-b border-neutral-800 pb-8">
            <div className="text-2xl font-black tracking-tight text-white">BorrowLoop</div>
            <div className="text-xs text-neutral-400">
              <a
                href="#help"
                onClick={(e) => {
                  e.preventDefault();
                  onNavigate('communities');
                }}
                className="hover:text-white transition"
              >
                Visit Community Center &rarr;
              </a>
            </div>
          </div>

          {/* 4 Link Columns */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-8 text-xs text-neutral-400">
            <div className="space-y-3">
              <h4 className="font-bold text-white uppercase tracking-wider text-[11px]">
                Platform
              </h4>
              <ul className="space-y-2">
                <li>
                  <button
                    type="button"
                    onClick={() => onNavigate('items')}
                    className="hover:text-white"
                  >
                    Borrow Gear
                  </button>
                </li>
                <li>
                  <button
                    type="button"
                    onClick={() => onNavigate('signup')}
                    className="hover:text-white"
                  >
                    Lend & Earn
                  </button>
                </li>
                <li>
                  <button
                    type="button"
                    onClick={() => onNavigate('communities')}
                    className="hover:text-white"
                  >
                    Campus Circles
                  </button>
                </li>
                <li>
                  <button
                    type="button"
                    onClick={() => onNavigate('login')}
                    className="hover:text-white"
                  >
                    Demo Wallet
                  </button>
                </li>
              </ul>
            </div>

            <div className="space-y-3">
              <h4 className="font-bold text-white uppercase tracking-wider text-[11px]">
                Trust & Safety
              </h4>
              <ul className="space-y-2">
                <li>
                  <span className="hover:text-white cursor-pointer">Two-Sided QR Handover</span>
                </li>
                <li>
                  <span className="hover:text-white cursor-pointer">Escrow Security Deposit</span>
                </li>
                <li>
                  <span className="hover:text-white cursor-pointer">Blind Rating System</span>
                </li>
                <li>
                  <span className="hover:text-white cursor-pointer">Dispute Resolution</span>
                </li>
              </ul>
            </div>

            <div className="space-y-3">
              <h4 className="font-bold text-white uppercase tracking-wider text-[11px]">
                Developers & API
              </h4>
              <ul className="space-y-2">
                <li>
                  <a
                    href="http://localhost:4000/v1/docs"
                    target="_blank"
                    rel="noreferrer"
                    className="hover:text-white"
                  >
                    Interactive Swagger Docs
                  </a>
                </li>
                <li>
                  <a
                    href="https://github.com/Devam759/Full-Stack-Project"
                    target="_blank"
                    rel="noreferrer"
                    className="hover:text-white"
                  >
                    GitHub Repository
                  </a>
                </li>
                <li>
                  <span className="hover:text-white cursor-pointer">Double-Entry Invariants</span>
                </li>
                <li>
                  <span className="hover:text-white cursor-pointer">CS1237 MERN Defense</span>
                </li>
              </ul>
            </div>

            <div className="space-y-3">
              <h4 className="font-bold text-white uppercase tracking-wider text-[11px]">
                Academic Project
              </h4>
              <p className="text-[11px] leading-relaxed text-neutral-400">
                CS1237 Full Stack Application Development Semester Project. Designed with React 18,
                Express, MongoDB Replica Set, and Redis.
              </p>
              <div className="pt-1">
                <span className="inline-block px-2.5 py-1 bg-amber-400/20 text-amber-300 border border-amber-400/30 rounded font-semibold text-[10px]">
                  Simulated Demo Currency
                </span>
              </div>
            </div>
          </div>

          {/* Bottom Bar: Copyright & Location */}
          <div className="border-t border-neutral-800 pt-8 flex flex-wrap items-center justify-between gap-4 text-xs text-neutral-400">
            <div>
              &copy; {new Date().getFullYear()} BorrowLoop Technologies Inc. Built for educational
              demonstration.
            </div>
            <div className="flex items-center gap-6">
              <span>English (IN)</span>
              <span>New Delhi, India</span>
            </div>
          </div>
        </div>
      </footer>
    </div>
  );
}

export default OnboardingScreen;
