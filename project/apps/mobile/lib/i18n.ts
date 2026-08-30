/**
 * i18n — the single source of truth for every user-facing string in the app,
 * in all three languages (Marathi / Hindi / English).
 *
 * Usage in a component:
 *   const { t } = useT();
 *   <Txt>{t('common.continue')}</Txt>
 *
 * Usage outside React (helpers, services):
 *   import { t } from '../lib/i18n';
 *   t('common.continue')
 *
 * Change the language anywhere and every mounted `useT()` re-renders:
 *   await setLanguage('hi');
 */
import { useSyncExternalStore } from 'react';
import * as SecureStore from 'expo-secure-store';
import { LANGUAGES, type Language } from '@kisanpool/shared';

export type { Language };
export { LANGUAGES };

const STORE_KEY = 'kp.language';
const FALLBACK: Language = 'en';

/* ------------------------------------------------------------------ strings -- */
/* Flat, dot-namespaced keys. `en` is the reference; `mr` / `hi` mirror it.     */
/* Interpolate with {token}: t('otp.demoCode', { code: '123456' }).            */

type Dict = Record<string, string>;

const en: Dict = {
  // common
  'common.appName': 'KisanPool',
  'common.tagline': 'Share a truck. Split the cost. Reach the mandi.',
  'common.continue': 'Continue',
  'common.back': 'Back',
  'common.done': 'Done',
  'common.cancel': 'Cancel',
  'common.save': 'Save',
  'common.retry': 'Retry',
  'common.next': 'Next',
  'common.close': 'Close',
  'common.yes': 'Yes',
  'common.no': 'No',
  'common.comingSoon': 'Coming soon',
  'common.notSet': 'Not set',
  'common.noneYet': 'None yet',
  'common.on': 'On',
  'common.off': 'Off',
  'common.loading': 'Opening KisanPool…',

  // languages
  'lang.mr': 'मराठी',
  'lang.hi': 'हिंदी',
  'lang.en': 'English',
  'lang.mr.english': 'Marathi',
  'lang.hi.english': 'Hindi',
  'lang.en.english': 'English',

  // welcome
  'welcome.chooseLanguage': 'Choose your language',
  'welcome.chooseLanguageNative': 'भाषा निवडा',

  // role
  'role.title': 'Who are you?',
  'role.titleNative': 'तुम्ही कोण आहात?',
  'role.farmer': 'Farmer',
  'role.farmerNative': 'शेतकरी',
  'role.farmerBlurb': 'I want to send my produce to a mandi',
  'role.transporter': 'Transporter',
  'role.transporterNative': 'वाहतूकदार',
  'role.transporterBlurb': 'I have a vehicle with space to share',
  'role.oneForNow':
    'You can only pick one for now. If you both farm and drive, create a second account later.',

  // verify / OTP
  'otp.title': 'Verify your number',
  'otp.titleNative': 'मोबाईल नंबर तपासा',
  'otp.mobileLabel': 'Mobile number',
  'otp.mobilePlaceholder': '10-digit mobile number',
  'otp.codeLabel': '6-digit code',
  'otp.sendOtp': 'Send OTP',
  'otp.verifyContinue': 'Verify & continue',
  'otp.resend': 'Resend code',
  'otp.resendShortly': 'Resend available shortly',
  'otp.noPassword': 'We will send you a 6-digit code. No password needed.',
  'otp.demoCode': 'Demo code: {code}',

  // farmer-details
  'farmerDetails.title': 'About you',
  'farmerDetails.titleNative': 'तुमची माहिती',
  'farmerDetails.nameLabel': 'Your name',
  'farmerDetails.namePlaceholder': 'e.g. Rahul Patil',
  'farmerDetails.placeLabel': 'Default pickup place',
  'farmerDetails.placePlaceholder': 'e.g. Pimpri, Pune',
  'farmerDetails.placeHelp':
    'We use this so you do not have to type your village on every request.',
  'farmerDetails.defaultFarm': 'My farm',

  // vehicle-register
  'vehicle.title': 'You and your vehicle',
  'vehicle.titleNative': 'तुम्ही आणि तुमचे वाहन',
  'vehicle.nameLabel': 'Your name',
  'vehicle.namePlaceholder': 'e.g. Mahesh Jadhav',
  'vehicle.nameHelp': 'Farmers see this name when they choose who carries their produce.',
  'vehicle.typeLabel': 'Vehicle type',
  'vehicle.regLabel': 'Registration number',
  'vehicle.regPlaceholder': 'MH12 AB 1234',
  'vehicle.regInvalid': 'Enter a valid number like MH12AB1234',
  'vehicle.capacityLabel': 'Capacity (kg)',
  'vehicle.capacityPlaceholder': 'e.g. 2500',
  'vehicle.rateLabel': 'Rate per km (₹)',
  'vehicle.ratePlaceholder': 'e.g. 36',
  'vehicle.continueDocuments': 'Continue to documents',
  'vehicle.pendingNote':
    'Your vehicle stays "Pending verification" until your documents are approved. You will not receive trip requests before that.',
  'vehicle.type.PICKUP': 'Pickup',
  'vehicle.type.TRUCK': 'Truck',
  'vehicle.type.TEMPO': 'Tempo',
  'vehicle.type.TRACTOR': 'Tractor',
  'vehicle.type.MINI_TRUCK': 'Mini truck',
  'vehicle.type.OTHER': 'Other',
  'vehicle.defaultBase': 'My base',

  // kyc
  'kyc.title': 'Verify your documents',
  'kyc.titleNative': 'कागदपत्रे तपासा',
  'kyc.verifiedTitle': 'Your documents are verified',
  'kyc.verifiedBody': 'You can go online and start receiving trip requests.',
  'kyc.pendingTitle': "You'll start receiving trip requests once your documents are verified",
  'kyc.pendingBody':
    'Your RC and driving licence must both be approved before your vehicle appears to farmers. PAN and bank details are needed to receive payouts.',
  'kyc.checking': 'Checking your documents…',
  'kyc.doc.RC': 'Registration Certificate (RC)',
  'kyc.doc.DL': 'Driving Licence (DL)',
  'kyc.doc.PAN': 'PAN card',
  'kyc.gate.trips': 'Required to receive trips',
  'kyc.gate.payouts': 'Required to receive payouts',
  'kyc.rejected': 'Rejected{reason} — please upload a clearer photo.',
  'kyc.upload': 'Upload',
  'kyc.replace': 'Replace',
  'kyc.reupload': 'Re-upload',
  'kyc.upiTitle': 'UPI ID for payouts',
  'kyc.upiHelp':
    'Your trip earnings build up in your KisanPool wallet. Withdraw them to this UPI ID any time.',
  'kyc.upiSaved': 'UPI ID saved',
  'kyc.upiLabel': 'UPI ID',
  'kyc.upiPlaceholder': 'name@bank',
  'kyc.saveUpi': 'Save UPI ID',

  // success
  'success.title': "You're all set!",
  'success.titleNative': 'तुमचं खातं तयार आहे',
  'success.goDashboard': 'Go to my dashboard',
  'success.farmerBody':
    'Create your first transport request — by tapping, or just by speaking to Servo AI.',
  'success.transporterBody':
    'Once your documents are verified you will start receiving trip requests near you.',

  // bottom nav
  'nav.home': 'Home',
  'nav.bookings': 'Bookings',
  'nav.mandi': 'Mandi',
  'nav.mandis': 'Mandis',
  'nav.support': 'Support',
  'nav.payments': 'Payments',
  'nav.profile': 'Profile',
  'nav.dashboard': 'Dashboard',
  'nav.requests': 'Requests',
  'nav.trips': 'Trips',
  'nav.earnings': 'Earnings',

  // profile
  'profile.title': 'Profile',
  'profile.account': 'Account',
  'profile.pickupLocation': 'Pickup location',
  'profile.language': 'Language',
  'profile.favouriteMandis': 'Favourite mandis',
  'profile.payments': 'Payments & receipts',
  'profile.notifications': 'Notifications',
  'profile.tripAlerts': 'Trip & offer alerts',
  'profile.notificationsHelp':
    'You are told when a transporter accepts your request, when your driver sets off, and when your share changes.',
  'profile.help': 'Help',
  'profile.support': 'Support & AI assistant',
  'profile.call': 'Call KisanPool',
  'profile.privacyTerms': 'Privacy & terms',
  'profile.signOut': 'Sign out',
  'profile.farmerId': 'Farmer · KP-{id}',
  'profile.chooseLanguage': 'Choose your language',
  'profile.chooseLanguageSubtitle': 'Servo AI will speak and listen in this language too.',
  'profile.languageUpdated': 'Language updated',
  'profile.signOutTitle': 'Sign out of KisanPool?',
  'profile.signOutMessage': 'You will need your mobile number and an OTP to sign back in.',
  'profile.version': 'KisanPool · v0.1.0',

  // errors / generic
  'error.title': 'Something went wrong',
  'error.generic': 'Please try again.',
  'error.offline': 'You appear to be offline.',
};

const hi: Dict = {
  'common.appName': 'KisanPool',
  'common.tagline': 'ट्रक साझा करें। खर्च बाँटें। मंडी तक पहुँचें।',
  'common.continue': 'आगे बढ़ें',
  'common.back': 'पीछे',
  'common.done': 'हो गया',
  'common.cancel': 'रद्द करें',
  'common.save': 'सहेजें',
  'common.retry': 'फिर कोशिश करें',
  'common.next': 'अगला',
  'common.close': 'बंद करें',
  'common.yes': 'हाँ',
  'common.no': 'नहीं',
  'common.comingSoon': 'जल्द आ रहा है',
  'common.notSet': 'तय नहीं',
  'common.noneYet': 'अभी कोई नहीं',
  'common.on': 'चालू',
  'common.off': 'बंद',
  'common.loading': 'KisanPool खुल रहा है…',

  'lang.mr': 'मराठी',
  'lang.hi': 'हिंदी',
  'lang.en': 'English',
  'lang.mr.english': 'मराठी',
  'lang.hi.english': 'हिंदी',
  'lang.en.english': 'अंग्रेज़ी',

  'welcome.chooseLanguage': 'अपनी भाषा चुनें',
  'welcome.chooseLanguageNative': 'भाषा चुनें',

  'role.title': 'आप कौन हैं?',
  'role.titleNative': 'आप कौन हैं?',
  'role.farmer': 'किसान',
  'role.farmerNative': 'किसान',
  'role.farmerBlurb': 'मुझे अपनी उपज मंडी तक भेजनी है',
  'role.transporter': 'ट्रांसपोर्टर',
  'role.transporterNative': 'ट्रांसपोर्टर',
  'role.transporterBlurb': 'मेरे पास जगह वाला वाहन है',
  'role.oneForNow':
    'अभी आप केवल एक ही चुन सकते हैं। यदि आप खेती भी करते हैं और गाड़ी भी चलाते हैं, तो बाद में दूसरा खाता बनाएँ।',

  'otp.title': 'अपना नंबर सत्यापित करें',
  'otp.titleNative': 'मोबाइल नंबर जाँचें',
  'otp.mobileLabel': 'मोबाइल नंबर',
  'otp.mobilePlaceholder': '10 अंकों का मोबाइल नंबर',
  'otp.codeLabel': '6 अंकों का कोड',
  'otp.sendOtp': 'OTP भेजें',
  'otp.verifyContinue': 'सत्यापित करें और आगे बढ़ें',
  'otp.resend': 'कोड फिर भेजें',
  'otp.resendShortly': 'कोड जल्द ही फिर भेज सकते हैं',
  'otp.noPassword': 'हम आपको 6 अंकों का कोड भेजेंगे। पासवर्ड की ज़रूरत नहीं।',
  'otp.demoCode': 'डेमो कोड: {code}',

  'farmerDetails.title': 'आपके बारे में',
  'farmerDetails.titleNative': 'आपकी जानकारी',
  'farmerDetails.nameLabel': 'आपका नाम',
  'farmerDetails.namePlaceholder': 'जैसे राहुल पाटिल',
  'farmerDetails.placeLabel': 'डिफ़ॉल्ट पिकअप जगह',
  'farmerDetails.placePlaceholder': 'जैसे पिंपरी, पुणे',
  'farmerDetails.placeHelp':
    'इससे आपको हर अनुरोध पर अपने गाँव का नाम टाइप नहीं करना पड़ता।',
  'farmerDetails.defaultFarm': 'मेरा खेत',

  'vehicle.title': 'आप और आपका वाहन',
  'vehicle.titleNative': 'आप और आपका वाहन',
  'vehicle.nameLabel': 'आपका नाम',
  'vehicle.namePlaceholder': 'जैसे महेश जाधव',
  'vehicle.nameHelp': 'किसान यह नाम देखते हैं जब वे तय करते हैं कि उनकी उपज कौन ले जाएगा।',
  'vehicle.typeLabel': 'वाहन का प्रकार',
  'vehicle.regLabel': 'रजिस्ट्रेशन नंबर',
  'vehicle.regPlaceholder': 'MH12 AB 1234',
  'vehicle.regInvalid': 'MH12AB1234 जैसा सही नंबर डालें',
  'vehicle.capacityLabel': 'क्षमता (किग्रा)',
  'vehicle.capacityPlaceholder': 'जैसे 2500',
  'vehicle.rateLabel': 'प्रति किमी दर (₹)',
  'vehicle.ratePlaceholder': 'जैसे 36',
  'vehicle.continueDocuments': 'दस्तावेज़ों की ओर बढ़ें',
  'vehicle.pendingNote':
    'आपके दस्तावेज़ मंज़ूर होने तक आपका वाहन "सत्यापन बाकी" रहेगा। उससे पहले आपको ट्रिप अनुरोध नहीं मिलेंगे।',
  'vehicle.type.PICKUP': 'पिकअप',
  'vehicle.type.TRUCK': 'ट्रक',
  'vehicle.type.TEMPO': 'टेम्पो',
  'vehicle.type.TRACTOR': 'ट्रैक्टर',
  'vehicle.type.MINI_TRUCK': 'मिनी ट्रक',
  'vehicle.type.OTHER': 'अन्य',
  'vehicle.defaultBase': 'मेरा अड्डा',

  'kyc.title': 'अपने दस्तावेज़ सत्यापित करें',
  'kyc.titleNative': 'दस्तावेज़ जाँचें',
  'kyc.verifiedTitle': 'आपके दस्तावेज़ सत्यापित हैं',
  'kyc.verifiedBody': 'आप ऑनलाइन जाकर ट्रिप अनुरोध पाना शुरू कर सकते हैं।',
  'kyc.pendingTitle': 'दस्तावेज़ सत्यापित होते ही आपको ट्रिप अनुरोध मिलने लगेंगे',
  'kyc.pendingBody':
    'किसानों को आपका वाहन दिखने से पहले आपका RC और ड्राइविंग लाइसेंस दोनों मंज़ूर होने चाहिए। भुगतान पाने के लिए PAN और बैंक विवरण ज़रूरी हैं।',
  'kyc.checking': 'आपके दस्तावेज़ जाँचे जा रहे हैं…',
  'kyc.doc.RC': 'रजिस्ट्रेशन सर्टिफिकेट (RC)',
  'kyc.doc.DL': 'ड्राइविंग लाइसेंस (DL)',
  'kyc.doc.PAN': 'PAN कार्ड',
  'kyc.gate.trips': 'ट्रिप पाने के लिए ज़रूरी',
  'kyc.gate.payouts': 'भुगतान पाने के लिए ज़रूरी',
  'kyc.rejected': 'अस्वीकृत{reason} — कृपया साफ़ फ़ोटो अपलोड करें।',
  'kyc.upload': 'अपलोड करें',
  'kyc.replace': 'बदलें',
  'kyc.reupload': 'फिर अपलोड करें',
  'kyc.upiTitle': 'भुगतान के लिए UPI ID',
  'kyc.upiHelp':
    'आपकी ट्रिप की कमाई आपके KisanPool वॉलेट में जमा होती है। इसे कभी भी इस UPI ID पर निकालें।',
  'kyc.upiSaved': 'UPI ID सहेजा गया',
  'kyc.upiLabel': 'UPI ID',
  'kyc.upiPlaceholder': 'name@bank',
  'kyc.saveUpi': 'UPI ID सहेजें',

  'success.title': 'सब तैयार है!',
  'success.titleNative': 'आपका खाता तैयार है',
  'success.goDashboard': 'मेरे डैशबोर्ड पर जाएँ',
  'success.farmerBody':
    'अपना पहला ट्रांसपोर्ट अनुरोध बनाएँ — टैप करके, या बस Servo AI से बोलकर।',
  'success.transporterBody':
    'दस्तावेज़ सत्यापित होते ही आपको आस-पास के ट्रिप अनुरोध मिलने लगेंगे।',

  'nav.home': 'होम',
  'nav.bookings': 'बुकिंग',
  'nav.mandi': 'मंडी',
  'nav.mandis': 'मंडियाँ',
  'nav.support': 'सहायता',
  'nav.payments': 'भुगतान',
  'nav.profile': 'प्रोफ़ाइल',
  'nav.dashboard': 'डैशबोर्ड',
  'nav.requests': 'अनुरोध',
  'nav.trips': 'ट्रिप',
  'nav.earnings': 'कमाई',

  'profile.title': 'प्रोफ़ाइल',
  'profile.account': 'खाता',
  'profile.pickupLocation': 'पिकअप जगह',
  'profile.language': 'भाषा',
  'profile.favouriteMandis': 'पसंदीदा मंडियाँ',
  'profile.payments': 'भुगतान और रसीदें',
  'profile.notifications': 'सूचनाएँ',
  'profile.tripAlerts': 'ट्रिप और ऑफ़र अलर्ट',
  'profile.notificationsHelp':
    'जब कोई ट्रांसपोर्टर आपका अनुरोध स्वीकार करता है, जब आपका ड्राइवर निकलता है, और जब आपका हिस्सा बदलता है, तब आपको बताया जाता है।',
  'profile.help': 'सहायता',
  'profile.support': 'सहायता और AI असिस्टेंट',
  'profile.call': 'KisanPool को कॉल करें',
  'profile.privacyTerms': 'गोपनीयता और शर्तें',
  'profile.signOut': 'साइन आउट',
  'profile.farmerId': 'किसान · KP-{id}',
  'profile.chooseLanguage': 'अपनी भाषा चुनें',
  'profile.chooseLanguageSubtitle': 'Servo AI इसी भाषा में बोलेगा और सुनेगा।',
  'profile.languageUpdated': 'भाषा बदली गई',
  'profile.signOutTitle': 'KisanPool से साइन आउट करें?',
  'profile.signOutMessage': 'वापस साइन इन करने के लिए आपको मोबाइल नंबर और OTP चाहिए होगा।',
  'profile.version': 'KisanPool · v0.1.0',

  'error.title': 'कुछ गड़बड़ हो गई',
  'error.generic': 'कृपया फिर कोशिश करें।',
  'error.offline': 'आप ऑफ़लाइन लग रहे हैं।',
};

const mr: Dict = {
  'common.appName': 'KisanPool',
  'common.tagline': 'ट्रक शेअर करा. खर्च वाटून घ्या. मंडईपर्यंत पोहोचा.',
  'common.continue': 'पुढे चला',
  'common.back': 'मागे',
  'common.done': 'झाले',
  'common.cancel': 'रद्द करा',
  'common.save': 'जतन करा',
  'common.retry': 'पुन्हा प्रयत्न करा',
  'common.next': 'पुढील',
  'common.close': 'बंद करा',
  'common.yes': 'होय',
  'common.no': 'नाही',
  'common.comingSoon': 'लवकरच येत आहे',
  'common.notSet': 'सेट केलेले नाही',
  'common.noneYet': 'अजून काहीही नाही',
  'common.on': 'चालू',
  'common.off': 'बंद',
  'common.loading': 'KisanPool उघडत आहे…',

  'lang.mr': 'मराठी',
  'lang.hi': 'हिंदी',
  'lang.en': 'English',
  'lang.mr.english': 'मराठी',
  'lang.hi.english': 'हिंदी',
  'lang.en.english': 'इंग्रजी',

  'welcome.chooseLanguage': 'तुमची भाषा निवडा',
  'welcome.chooseLanguageNative': 'भाषा निवडा',

  'role.title': 'तुम्ही कोण आहात?',
  'role.titleNative': 'तुम्ही कोण आहात?',
  'role.farmer': 'शेतकरी',
  'role.farmerNative': 'शेतकरी',
  'role.farmerBlurb': 'मला माझा शेतमाल मंडईला पाठवायचा आहे',
  'role.transporter': 'वाहतूकदार',
  'role.transporterNative': 'वाहतूकदार',
  'role.transporterBlurb': 'माझ्याकडे जागा असलेले वाहन आहे',
  'role.oneForNow':
    'सध्या तुम्ही फक्त एकच निवडू शकता. तुम्ही शेती करता आणि वाहनही चालवता, तर नंतर दुसरे खाते तयार करा.',

  'otp.title': 'तुमचा नंबर पडताळा',
  'otp.titleNative': 'मोबाईल नंबर तपासा',
  'otp.mobileLabel': 'मोबाईल नंबर',
  'otp.mobilePlaceholder': '10 अंकी मोबाईल नंबर',
  'otp.codeLabel': '6 अंकी कोड',
  'otp.sendOtp': 'OTP पाठवा',
  'otp.verifyContinue': 'पडताळा आणि पुढे चला',
  'otp.resend': 'कोड पुन्हा पाठवा',
  'otp.resendShortly': 'कोड लवकरच पुन्हा पाठवता येईल',
  'otp.noPassword': 'आम्ही तुम्हाला 6 अंकी कोड पाठवू. पासवर्डची गरज नाही.',
  'otp.demoCode': 'डेमो कोड: {code}',

  'farmerDetails.title': 'तुमच्याबद्दल',
  'farmerDetails.titleNative': 'तुमची माहिती',
  'farmerDetails.nameLabel': 'तुमचे नाव',
  'farmerDetails.namePlaceholder': 'उदा. राहुल पाटील',
  'farmerDetails.placeLabel': 'नेहमीचे पिकअप ठिकाण',
  'farmerDetails.placePlaceholder': 'उदा. पिंपरी, पुणे',
  'farmerDetails.placeHelp':
    'यामुळे प्रत्येक विनंतीवर तुम्हाला तुमच्या गावाचे नाव टाइप करावे लागत नाही.',
  'farmerDetails.defaultFarm': 'माझे शेत',

  'vehicle.title': 'तुम्ही आणि तुमचे वाहन',
  'vehicle.titleNative': 'तुम्ही आणि तुमचे वाहन',
  'vehicle.nameLabel': 'तुमचे नाव',
  'vehicle.namePlaceholder': 'उदा. महेश जाधव',
  'vehicle.nameHelp': 'शेतकरी हे नाव पाहतात जेव्हा ते ठरवतात की त्यांचा माल कोण नेणार.',
  'vehicle.typeLabel': 'वाहनाचा प्रकार',
  'vehicle.regLabel': 'नोंदणी क्रमांक',
  'vehicle.regPlaceholder': 'MH12 AB 1234',
  'vehicle.regInvalid': 'MH12AB1234 सारखा वैध क्रमांक टाका',
  'vehicle.capacityLabel': 'क्षमता (किलो)',
  'vehicle.capacityPlaceholder': 'उदा. 2500',
  'vehicle.rateLabel': 'प्रति किमी दर (₹)',
  'vehicle.ratePlaceholder': 'उदा. 36',
  'vehicle.continueDocuments': 'कागदपत्रांकडे चला',
  'vehicle.pendingNote':
    'तुमची कागदपत्रे मंजूर होईपर्यंत तुमचे वाहन "पडताळणी बाकी" राहील. त्यापूर्वी तुम्हाला ट्रिप विनंत्या मिळणार नाहीत.',
  'vehicle.type.PICKUP': 'पिकअप',
  'vehicle.type.TRUCK': 'ट्रक',
  'vehicle.type.TEMPO': 'टेम्पो',
  'vehicle.type.TRACTOR': 'ट्रॅक्टर',
  'vehicle.type.MINI_TRUCK': 'मिनी ट्रक',
  'vehicle.type.OTHER': 'इतर',
  'vehicle.defaultBase': 'माझा तळ',

  'kyc.title': 'तुमची कागदपत्रे पडताळा',
  'kyc.titleNative': 'कागदपत्रे तपासा',
  'kyc.verifiedTitle': 'तुमची कागदपत्रे पडताळली आहेत',
  'kyc.verifiedBody': 'तुम्ही ऑनलाइन जाऊन ट्रिप विनंत्या मिळवणे सुरू करू शकता.',
  'kyc.pendingTitle': 'कागदपत्रे पडताळल्यावर तुम्हाला ट्रिप विनंत्या मिळू लागतील',
  'kyc.pendingBody':
    'शेतकऱ्यांना तुमचे वाहन दिसण्यापूर्वी तुमचे RC आणि वाहन परवाना दोन्ही मंजूर व्हावे लागतात. पैसे मिळवण्यासाठी PAN आणि बँक तपशील आवश्यक आहेत.',
  'kyc.checking': 'तुमची कागदपत्रे तपासली जात आहेत…',
  'kyc.doc.RC': 'नोंदणी प्रमाणपत्र (RC)',
  'kyc.doc.DL': 'वाहन परवाना (DL)',
  'kyc.doc.PAN': 'PAN कार्ड',
  'kyc.gate.trips': 'ट्रिप मिळवण्यासाठी आवश्यक',
  'kyc.gate.payouts': 'पैसे मिळवण्यासाठी आवश्यक',
  'kyc.rejected': 'नाकारले{reason} — कृपया स्पष्ट फोटो अपलोड करा.',
  'kyc.upload': 'अपलोड करा',
  'kyc.replace': 'बदला',
  'kyc.reupload': 'पुन्हा अपलोड करा',
  'kyc.upiTitle': 'पैसे मिळवण्यासाठी UPI ID',
  'kyc.upiHelp':
    'तुमची ट्रिपची कमाई तुमच्या KisanPool वॉलेटमध्ये जमा होते. ती कधीही या UPI ID वर काढा.',
  'kyc.upiSaved': 'UPI ID जतन केला',
  'kyc.upiLabel': 'UPI ID',
  'kyc.upiPlaceholder': 'name@bank',
  'kyc.saveUpi': 'UPI ID जतन करा',

  'success.title': 'सर्व तयार आहे!',
  'success.titleNative': 'तुमचं खातं तयार आहे',
  'success.goDashboard': 'माझ्या डॅशबोर्डवर जा',
  'success.farmerBody':
    'तुमची पहिली वाहतूक विनंती तयार करा — टॅप करून, किंवा फक्त Servo AI शी बोलून.',
  'success.transporterBody':
    'कागदपत्रे पडताळल्यावर तुम्हाला जवळच्या ट्रिप विनंत्या मिळू लागतील.',

  'nav.home': 'होम',
  'nav.bookings': 'बुकिंग',
  'nav.mandi': 'मंडई',
  'nav.mandis': 'मंडया',
  'nav.support': 'मदत',
  'nav.payments': 'पेमेंट',
  'nav.profile': 'प्रोफाइल',
  'nav.dashboard': 'डॅशबोर्ड',
  'nav.requests': 'विनंत्या',
  'nav.trips': 'ट्रिप',
  'nav.earnings': 'कमाई',

  'profile.title': 'प्रोफाइल',
  'profile.account': 'खाते',
  'profile.pickupLocation': 'पिकअप ठिकाण',
  'profile.language': 'भाषा',
  'profile.favouriteMandis': 'आवडत्या मंडया',
  'profile.payments': 'पेमेंट आणि पावत्या',
  'profile.notifications': 'सूचना',
  'profile.tripAlerts': 'ट्रिप आणि ऑफर सूचना',
  'profile.notificationsHelp':
    'वाहतूकदार तुमची विनंती स्वीकारतो, तुमचा चालक निघतो आणि तुमचा वाटा बदलतो तेव्हा तुम्हाला कळवले जाते.',
  'profile.help': 'मदत',
  'profile.support': 'मदत आणि AI सहाय्यक',
  'profile.call': 'KisanPool ला कॉल करा',
  'profile.privacyTerms': 'गोपनीयता आणि अटी',
  'profile.signOut': 'साइन आउट',
  'profile.farmerId': 'शेतकरी · KP-{id}',
  'profile.chooseLanguage': 'तुमची भाषा निवडा',
  'profile.chooseLanguageSubtitle': 'Servo AI याच भाषेत बोलेल आणि ऐकेल.',
  'profile.languageUpdated': 'भाषा बदलली',
  'profile.signOutTitle': 'KisanPool मधून साइन आउट करायचे?',
  'profile.signOutMessage': 'पुन्हा साइन इन करण्यासाठी तुम्हाला मोबाईल नंबर आणि OTP लागेल.',
  'profile.version': 'KisanPool · v0.1.0',

  'error.title': 'काहीतरी चूक झाली',
  'error.generic': 'कृपया पुन्हा प्रयत्न करा.',
  'error.offline': 'तुम्ही ऑफलाइन दिसत आहात.',
};

const resources: Record<Language, Dict> = { en, hi, mr };

/* ------------------------------------------------------------------- store -- */

let current: Language = FALLBACK;
const listeners = new Set<() => void>();

const notify = (): void => {
  for (const l of listeners) l();
};

const subscribe = (listener: () => void): (() => void) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};

const getSnapshot = (): Language => current;

const isLanguage = (value: unknown): value is Language =>
  typeof value === 'string' && (LANGUAGES as readonly string[]).includes(value);

/** Current language without subscribing (for non-React code). */
export const getLanguage = (): Language => current;

/**
 * Switch the app language. Every mounted `useT()` re-renders, and the choice is
 * remembered across restarts. Persisting failures are non-fatal.
 */
export async function setLanguage(language: Language): Promise<void> {
  if (!isLanguage(language)) return;
  if (language !== current) {
    current = language;
    notify(); // re-render every mounted useT()
  }
  try {
    await SecureStore.setItemAsync(STORE_KEY, language);
  } catch {
    // a remembered language is a convenience, not a requirement
  }
}

/**
 * Load the saved language at startup. Falls back to `preferred` (e.g. the
 * signed-in user's `language`), then to English.
 */
export async function initI18n(preferred?: Language | null): Promise<Language> {
  let next: Language = isLanguage(preferred) ? preferred : FALLBACK;
  try {
    const saved = await SecureStore.getItemAsync(STORE_KEY);
    if (isLanguage(saved)) next = saved;
  } catch {
    // no stored value — use the preferred/fallback
  }
  if (next !== current) {
    current = next;
    notify();
  }
  return current;
}

/* ------------------------------------------------------------- translation -- */

const interpolate = (template: string, vars?: Record<string, string | number>): string =>
  vars
    ? template.replace(/\{(\w+)\}/g, (_, key: string) =>
        key in vars ? String(vars[key]) : `{${key}}`,
      )
    : template;

/**
 * Translate a key in the current language. Unknown keys fall back to English,
 * then to the key itself so a missing string is visible rather than blank.
 */
export function t(key: string, vars?: Record<string, string | number>): string {
  const value = resources[current][key] ?? resources[FALLBACK][key] ?? key;
  return interpolate(value, vars);
}

export type TranslateFn = typeof t;

/**
 * React hook. Re-renders the component whenever the language changes.
 * Returns the bound `t` and the active language code.
 */
export function useT(): { t: TranslateFn; lang: Language } {
  const lang = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
  return { t, lang };
}
