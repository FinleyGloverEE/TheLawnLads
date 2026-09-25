/* =====================================================================
   THE LAWN LADS — SITE SETTINGS
   This is the one file you normally need to edit. Every page reads it.
   ===================================================================== */
var LAWN_LADS_CONFIG = {
  // WhatsApp: international format, digits only, no "+" or spaces.
  // 07912 613180  ->  447912613180
  whatsappNumber: "447912613180",
  whatsappMessage: "Hi The Lawn Lads, I'd like to get a quote for my garden.",

  // Phone shown on the site and used for "Call" buttons
  phoneDisplay: "07912 613180",
  phoneInternational: "+447912613180",

  // Email shown on the site
  contactEmail: "quotes@thelawnlads.co.uk",

  // Online booking (Cal.com)
  bookingUrl: "https://cal.com/thelawnlads",

  // Where quote requests are sent: the web app address of your Google Apps Script
  // (see SETUP.md section 1). It looks like
  // "https://script.google.com/macros/s/AKfycb.../exec". Paste it between the quotes.
  // Until it's filled in, the form tells people to WhatsApp or call instead.
  quoteEndpoint: "",

  // Postcode checker: places we cover, with a centre point for distance checks.
  serviceAreas: [
    { name: "Hinckley",      lat: 52.5413, lon: -1.3733 },
    { name: "Burbage",       lat: 52.5272, lon: -1.3513 },
    { name: "Barwell",       lat: 52.5669, lon: -1.3440 },
    { name: "Earl Shilton",  lat: 52.5770, lon: -1.3110 },
    { name: "Stoke Golding", lat: 52.5703, lon: -1.4110 },
    { name: "Sapcote",       lat: 52.5389, lon: -1.2742 }
  ],
  // Used only if the postcode lookup service can't be reached. These postcode
  // sectors roughly match the areas above (they also include a few nearby
  // villages), so results from this list are shown as "we'll confirm".
  fallbackSectors: ["LE10 0", "LE10 1", "LE10 2", "LE10 3", "LE9 4", "LE9 7", "LE9 8", "CV13 6"]
};
