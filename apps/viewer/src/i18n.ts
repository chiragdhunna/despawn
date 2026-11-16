/** Viewer strings. English is the source of truth; the Hindi set needs native-speaker review. */
export type Lang = 'en' | 'hi';

const en = {
  'lang.en': 'English',
  'lang.hi': 'हिन्दी',
  'waiting.title': 'Waiting for the owner to approve',
  'waiting.code': "The owner's phone should show this code",
  'waiting.help': 'Ask the owner to check the code and tap Approve on their phone.',
  'connecting.title': 'Connecting',
  'preparing.title': 'Approved. Preparing the document.',
  'preparing.slow': 'Slow connection. Still working.',
  'ready.approved': 'Approved by the owner',
  'ready.visible': 'Visible for',
  'ready.step1': 'Press Print.',
  'ready.step2': 'Choose your printer.',
  'ready.print': 'Print',
  'ready.selfDestroy': 'This page destroys itself after printing.',
  'ready.help': "Print window didn't open?",
  'ready.helpBody': 'Allow pop-ups for this site, or press Ctrl+P.',
  'ready.page': 'Page',
  'ready.ownerOffline': "The owner's phone is not responding. This page will wipe itself soon.",
  'printing.title': 'Sending to printer. Take the pages from the tray.',
  'confirm.title': 'Did the pages print?',
  'confirm.yes': 'Yes, printed',
  'confirm.again': 'Print again',
  'finishing.title': 'Finishing. This page will wipe itself in a moment.',
  'destroyed.title': 'Destroyed.',
  'destroyed.body': 'This page no longer has the document.',
  'destroyed.close': 'You can close this tab.',
  'reason.PRINTED': 'Printed.',
  'reason.OWNER_KILLED': 'The owner ended the session.',
  'reason.CANCELLED': 'The owner cancelled the session.',
  'reason.LIVE_TIMEOUT': 'Time ran out.',
  'reason.LINK_EXPIRED': 'The link expired.',
  'reason.HEARTBEAT_LOST': 'Connection to the owner was lost.',
  'reason.RELEASE_TIMEOUT': 'The document took too long to open.',
  'reason.SHOP_WIPED': 'Closed.',
  'reason.OFFLINE': 'Connection to the owner was lost.',
  'reason.ERROR': 'Something went wrong.',
  'reason.DENIED': 'The owner did not approve this request.',
  'invalid.title': 'This link is not valid.',
  'invalid.body': 'It has expired or was already used. Ask the owner for a new link.',
  'busy.title': 'Too many people opened this link.',
  'busy.body': 'Ask the owner to send a new link.',
  'unsupported.title': 'This browser is too old.',
  'unsupported.body':
    'It cannot open the document securely. Open this link in Chrome, Edge or Firefox.',
  'lost.title': 'Connection lost.',
  'lost.body': 'Reload this page to try again, or ask the owner for a new link.',
} as const;

export type StringKey = keyof typeof en;

const hi: Record<StringKey, string> = {
  'lang.en': 'English',
  'lang.hi': 'हिन्दी',
  'waiting.title': 'फ़ाइल के मालिक की मंज़ूरी का इंतज़ार है',
  'waiting.code': 'मालिक के फ़ोन पर यही कोड दिखना चाहिए',
  'waiting.help': 'मालिक से कहें कि कोड मिलाकर अपने फ़ोन पर Approve दबाएँ।',
  'connecting.title': 'जुड़ रहे हैं',
  'preparing.title': 'मंज़ूरी मिल गई। दस्तावेज़ तैयार हो रहा है।',
  'preparing.slow': 'कनेक्शन धीमा है। काम जारी है।',
  'ready.approved': 'मालिक ने मंज़ूरी दे दी',
  'ready.visible': 'दिखेगा',
  'ready.step1': 'Print दबाएँ।',
  'ready.step2': 'अपना प्रिंटर चुनें।',
  'ready.print': 'Print',
  'ready.selfDestroy': 'प्रिंट के बाद यह पेज अपने आप मिट जाएगा।',
  'ready.help': 'प्रिंट विंडो नहीं खुली?',
  'ready.helpBody': 'इस साइट के लिए पॉप-अप की अनुमति दें, या Ctrl+P दबाएँ।',
  'ready.page': 'पेज',
  'ready.ownerOffline': 'मालिक का फ़ोन जवाब नहीं दे रहा। यह पेज जल्दी ही अपने आप मिट जाएगा।',
  'printing.title': 'प्रिंटर को भेजा जा रहा है। ट्रे से पेज ले लें।',
  'confirm.title': 'क्या पेज प्रिंट हुए?',
  'confirm.yes': 'हाँ, प्रिंट हो गए',
  'confirm.again': 'फिर से प्रिंट करें',
  'finishing.title': 'पूरा हो रहा है। यह पेज अभी अपने आप मिट जाएगा।',
  'destroyed.title': 'मिटा दिया गया।',
  'destroyed.body': 'अब इस पेज में दस्तावेज़ नहीं है।',
  'destroyed.close': 'आप यह टैब बंद कर सकते हैं।',
  'reason.PRINTED': 'प्रिंट हो गया।',
  'reason.OWNER_KILLED': 'मालिक ने सत्र खत्म कर दिया।',
  'reason.CANCELLED': 'मालिक ने सत्र रद्द कर दिया।',
  'reason.LIVE_TIMEOUT': 'समय खत्म हो गया।',
  'reason.LINK_EXPIRED': 'लिंक की अवधि खत्म हो गई।',
  'reason.HEARTBEAT_LOST': 'मालिक से कनेक्शन टूट गया।',
  'reason.RELEASE_TIMEOUT': 'दस्तावेज़ खुलने में बहुत देर लगी।',
  'reason.SHOP_WIPED': 'बंद किया गया।',
  'reason.OFFLINE': 'मालिक से कनेक्शन टूट गया।',
  'reason.ERROR': 'कुछ गड़बड़ हो गई।',
  'reason.DENIED': 'मालिक ने इस अनुरोध को मंज़ूर नहीं किया।',
  'invalid.title': 'यह लिंक सही नहीं है।',
  'invalid.body': 'यह खत्म हो चुका है या पहले इस्तेमाल हो चुका है। मालिक से नया लिंक माँगें।',
  'busy.title': 'इस लिंक को बहुत लोगों ने खोला।',
  'busy.body': 'मालिक से नया लिंक भेजने को कहें।',
  'unsupported.title': 'यह ब्राउज़र बहुत पुराना है।',
  'unsupported.body':
    'यह दस्तावेज़ सुरक्षित तरीके से नहीं खोल सकता। इस लिंक को Chrome, Edge या Firefox में खोलें।',
  'lost.title': 'कनेक्शन टूट गया।',
  'lost.body': 'दोबारा कोशिश के लिए पेज रीलोड करें, या मालिक से नया लिंक माँगें।',
};

const TABLES: Record<Lang, Record<StringKey, string>> = { en, hi };

export function t(lang: Lang, key: StringKey): string {
  return TABLES[lang][key];
}

export function detectLang(languages: readonly string[]): Lang {
  for (const l of languages) {
    if (l.toLowerCase().indexOf('hi') === 0) {
      return 'hi';
    }
    if (l.toLowerCase().indexOf('en') === 0) {
      return 'en';
    }
  }
  return 'en';
}

export function allKeys(): StringKey[] {
  return Object.keys(en) as StringKey[];
}

export function tableFor(lang: Lang): Record<StringKey, string> {
  return TABLES[lang];
}
