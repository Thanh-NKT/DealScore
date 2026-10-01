/**
 * Brands draft clustering can recognise even before the catalog has verified products of them
 * (product_brands() only lists brands of existing products). Written as the maker writes itself.
 * Add a brand here; aliases go in aliases.ts.
 */
export const KNOWN_BRANDS: readonly string[] = [
  // Phones, computers, accessories
  "Apple", "Samsung", "Xiaomi", "Oppo", "Vivo", "Realme", "Nokia", "Huawei", "Honor", "OnePlus", "Google",
  "Asus", "Acer", "Dell", "HP", "Lenovo", "MSI", "Gigabyte", "LG", "Microsoft",
  "Logitech", "Razer", "Corsair", "SteelSeries", "HyperX", "Rapoo", "Akko", "Keychron", "Dareu", "Fuhlen",
  "Anker", "Baseus", "Ugreen", "Belkin", "Aukey", "Xmobile", "Energizer",
  "Kingston", "Western Digital", "Seagate", "Crucial", "Sandisk", "Lexar", "Transcend", "Adata", "Team Group",
  "TP-Link", "Tenda", "Mercusys", "Totolink", "Ruijie",
  // Audio, TV, camera
  "Sony", "JBL", "Bose", "Sennheiser", "Marshall", "Edifier", "Soundpeats", "Jabra", "Beats", "Audio-Technica",
  "TCL", "Panasonic", "Sharp", "Toshiba", "Canon", "Nikon", "Fujifilm", "GoPro", "DJI", "Insta360",
  // Home appliances
  "Philips", "Electrolux", "Tefal", "Lock&Lock", "Sunhouse", "Kangaroo", "Midea", "Daikin",
  "Coway", "Hitachi", "Bluestone", "Locknlock", "Cuckoo", "Deerma", "Dreame", "Ecovacs",
  "Roborock", "Dyson", "Karcher",
  // Beauty & personal care
  "La Roche-Posay", "Bioderma", "Cerave", "Cetaphil", "Vichy", "Eucerin", "Avène", "Anessa", "Skin1004",
  "Innisfree", "Some By Mi", "Klairs", "Paula's Choice", "The Ordinary", "L'Oréal", "Maybelline",
  "Senka", "Hada Labo", "Nivea", "Garnier", "Neutrogena", "Laneige", "Sulwhasoo", "Oral-B",
  // Mother & baby, food
  "Pigeon", "Moony", "Merries", "Huggies", "Bobby", "Comotomo", "Philips Avent", "Similac", "Enfa", "Aptamil",
  "Nestlé", "Vinamilk", "TH True Milk",
  // Sports & fashion
  "Nike", "Adidas", "Puma", "Asics", "Mizuno", "Yonex", "Garmin", "Coros", "Amazfit",
];
