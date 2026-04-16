// --- CONFIGURATION ---
// Set HUBSPOT_ACCESS_TOKEN securely in Project Settings (gear icon) > Script Properties
const HUBSPOT_ACCESS_TOKEN = PropertiesService.getScriptProperties().getProperty('HUBSPOT_ACCESS_TOKEN');
const LOG_EMAIL = 'dev@bestbuymetals.com'; 
//const NOTIFICATION_EMAIL = 'jacob@bestbuymetals.com'; // <-- Change this to the target email address
const NOTIFICATION_EMAIL = 'info@bestbuymetals.com, lead-archive@bestbuymetals.com'; // <-- Change this to the target email address
const SENDER_ALIAS = 'bluemail@bestbuymetals.com'; // <-- OPTIONAL: Enter a verified alias (e.g., 'sales@bestbuymetals.com'). Leave blank for default.
const NOTE_TO_INQUIRY_ASSOC_ID = null; // <-- OPTIONAL: Add your Note-to-Inquiry Association Type ID here (e.g., 228)


// --- PIPELINE CONFIGURATION ---
// Map each location to its specific HubSpot Pipeline ID and Initial Deal Stage ID.
// Currently defaults to your provided pipeline ("878985997") but you should update these!
const PIPELINE_MAP = {
  "cleveland": { pipeline: "878985997", dealstage: "1320561848" },
  "chattanooga": { pipeline: "878985997", dealstage: "1320561848" }, 
  "dalton": { pipeline: "878985997", dealstage: "1320561848" },
  "asheville": { pipeline: "878985997", dealstage: "1320561848" },
  "greenville": { pipeline: "878985997", dealstage: "1320561848" },
  "charlotte": { pipeline: "878985997", dealstage: "1320561848" },
  "knoxville": { pipeline: "878985997", dealstage: "1320561848" },
  "national": { pipeline: "878985997", dealstage: "1320561848" } // Fallback/National
};

// --- MAPS CONFIGURATION ---
const GOOGLE_MAPS_API_KEY = PropertiesService.getScriptProperties().getProperty('GOOGLE_MAPS_API_KEY');
const LOCATIONS = {
  "Cleveland": '1652 S Lee Hwy Cleveland,TN',
  "Chattanooga": '2300 E 23rd St Chattanooga,TN',
  "Knoxville": '5204 N Middlebrook Pike Knoxville,TN',
  "Dalton": '815 Walnut Ave Dalton, GA',
  "Asheville": '300 Sardis Rd Asheville, NC',
  "Greenville": '2705 Poinsett Hwy Greenville, SC',
  "Charlotte": '174 Gasoline Aly Dr, Mooresville, NC',
};


// ==========================================
// PRIMARY WEBHOOK HANDLER
// ==========================================
function doPost(e) {
  let logBody = "HubSpot Webhook Execution Log:\n\n";

  try {
    const requestData = JSON.parse(e.postData.contents);
    
    // Inputs from HubSpot Webhook for CRM Routing
    const urlToScan = (requestData.url_input || "").toLowerCase();
    let locationInput = (requestData.location_name || "").toLowerCase().trim();
    const recordId = requestData.hs_object_id; // The Enrolled Contact ID
    
    // Inputs from HubSpot Webhook strictly for the Email Notification
    const firstName = requestData.firstname || "Not Provided";
    const lastName = requestData.lastname || "Not Provided";
    const email = requestData.email || "Not Provided";
    
    // Format the phone number to (XXX) XXX-XXXX if it is a standard US number
    const rawPhone = requestData.phone || requestData.mobilephone || requestData.mobile_phone || requestData.phone_number__form_ || "";
    let phone = "Not Provided";
    if (rawPhone) {
      const cleaned = ('' + rawPhone).replace(/\D/g, '');
      const match = cleaned.match(/^(?:1)?(\d{3})(\d{3})(\d{4})$/);
      phone = match ? '(' + match[1] + ') ' + match[2] + '-' + match[3] : rawPhone;
    }

    const postalCode = requestData.zip || "Not Provided";
    const floatingMessage = requestData.floating_contact_form_message || "Not Provided";
    const lastPageSeen = requestData.last_page_seen || "Not Provided";
    
    // --- Contractor, Site Address, and Measurement Method ---
    const contractor = requestData.is_a_contractor || "Not Provided";
    
    // Map internal HubSpot dropdown IDs to readable text
    const measurementMap = {
      "eZ44Uy5eUq5jiG6NREYmY": "Drawing(s)",
      "HghiuGEdHDtlvwuo8-l-D": "Satellite Image"
    };
    const rawMeasurement = requestData.measurement_method;
    const measurementMethod = rawMeasurement ? (measurementMap[rawMeasurement] || rawMeasurement) : "Not Provided";
    
    // Site Address (5 properties)
    const siteStreet1 = requestData.site_address_line_1 || "Not Provided";
    const siteStreet2 = requestData.site_address_line_2 || ""; // Optional, will hide if empty
    const siteCity = requestData.site_address_city || "Not Provided";
    const siteState = requestData.site_address_state || "Not Provided";
    const siteZip = requestData.site_address_zip_code || "Not Provided";

    // Extract attachment links
    const rawAttachmentString = requestData.attachment_link || requestData.attachment || requestData.file_upload || requestData.request_pricing_attachment || "Not Provided";
    const attachmentLinks = rawAttachmentString !== "Not Provided" ? rawAttachmentString.split(';').map(l => l.trim()).filter(l => l.length > 0) : [];

    logBody += `--- INCOMING DATA ---\nContact ID: ${recordId}\nURL: ${urlToScan}\nLocation: ${locationInput || "None Provided"}\nZip Code: ${postalCode}\nAttachments Found: ${attachmentLinks.length}\n\n`;

    if (!recordId) {
      throw new Error("Missing hs_object_id (Contact ID)");
    }

    // ==========================================
    // STEP 0: DETERMINE LOCATION VIA MAPS API
    // ==========================================
    let driveData = null;
    if (!locationInput && postalCode !== "Not Provided") {
      logBody += `--- LOCATION ROUTING ---\nLocation missing from form. Calculating closest store for zip: ${postalCode}...\n`;
      driveData = getAttributedDriveTimeData(postalCode, LOCATIONS);
      
      if (driveData && driveData.bbm_location) {
        locationInput = driveData.bbm_location.toLowerCase();
        logBody += `Calculated BBM Location: ${driveData.bbm_location} (${driveData.bbm_location_minutes} mins)\n\n`;
      } else {
        locationInput = "national";
        logBody += `Maps calculation failed or no results. Defaulting to 'national'.\n\n`;
      }
    } else if (!locationInput) {
      locationInput = "national"; // Fallback if no zip and no location
      logBody += `--- LOCATION ROUTING ---\nNo location or zip code provided. Defaulting to 'national'.\n\n`;
    }

    // --- STEP 1: SCAN URL FOR SLUG ---
    const slugList = [
      "sentry-shingle", "kasselwood-shake", "kasselwood-slate", "arrowline-enhanced-slate", 
      "cee-purlin", "zee-purlin", "channel", "hat-channel", "angle", "eave-strut", 
      "stonewood-shake", "arrowline-enhanced-shake", "arrowline-slate", "matterhorn-shake", 
      "matterhorn-tile", "matterhorn-slate", "cleo-tile", "sapphire-european-tile", 
      "victorian-shingle", "central-loc", "sentry-slate", "image-ii", "vertical-seam", 
      "coastal-wave-tile", "cedar-creek-shake", "north-ridge-slate", "decra-villa", 
      "decra-tile", "decra-shingle-xd", "decra-shake-xd", "decra-shake", "2-5-corrugated", 
      "1-25-corrugated", "7-8-corrugated", "arrowline-shake", "sentry-shake", "edco-board-batten", 
      "edco-traditional-lap-siding", "edco-dutchlap-siding", "barrel-vault", "pacific-tile", 
      "cottage-shingle", "5v-crimp", "pine-crest-shake", "granite-ridge", "tuff-rib", 
      "apex-panel", "custom-metal-panels", "craftsman-plank", "steel-soffit", "stile-spanish-tile", 
      "r-panel", "snap-seam", "craftsman-board-batten", "craftsman-lap", "3-4-corrugated", 
      "wood-screws", "self-drilling-screws", "pancake-screws", "pipe-boots", "closures", 
      "ridge-vent-material", "snow-guards", "chimney-caps", "cupolas", "scupper-boxes", 
      "parapet-caps", "custom-flashing", "5-k-gutter", "6-k-gutter", "commercial-gutters", 
      "palisade-synthetic-underlayment", "roof-commander-underlayment", "30-lb-felt-underlayment", 
      "ice-water-shield-underlayment", "fiberglass-backed-insulation", "double-bubble-insulation", 
      "fan-fold-insulation", "cut-and-shear", "bend-and-hem", "punch-and-fasten", "roof-safety", 
      "1x4-lathing-strips", "6x6-posts", "8x8-posts", "2x6-boards", "steel-tubing", "piano-shingle", 
      "titan-loc-150", "titan-loc-100", "steel-trusses", "pinnacle-board-batten-siding", 
      "endura-seam", "bbm-board-batten"
    ];

    slugList.sort((a, b) => b.length - a.length);

    let foundProduct = "";
    for (const slug of slugList) {
      if (urlToScan.includes(slug.toLowerCase())) {
        foundProduct = slug;
        break; 
      }
    }

    // --- STEP 2: CHECK STORE AVAILABILITY ---
    const storeData = {
      "cleveland": ["tuff-rib","r-panel","5v-crimp","2-5-corrugated","1-25-corrugated","7-8-corrugated","3-4-corrugated","titan-loc-100","titan-loc-150","endura-seam","snap-seam","image-ii","snap-loc-150","vertical-seam","bbm-board-batten","flush-loc","steel-soffit","craftsman-board-batten","craftsman-lap","edco-board-batten","hat-channel","steel-tubing","american-pole-barn","steel-truss","stile-spanish-tile","apex-panel","steel-trusses","craftsman-steel-board-and-batten"],
      "chattanooga": ["tuff-rib","r-panel","5v-crimp","2-5-corrugated","1-25-corrugated","7-8-corrugated","3-4-corrugated","titan-loc-100","titan-loc-150","endura-seam","snap-seam","image-ii","snap-loc-150","vertical-seam","bbm-board-batten","flush-loc","steel-soffit","craftsman-board-batten","craftsman-lap","edco-board-batten","hat-channel","steel-tubing","american-pole-barn","steel-truss","stile-spanish-tile","apex-panel","steel-trusses","craftsman-steel-board-and-batten"],
      "dalton": ["tuff-rib","r-panel","5v-crimp","2-5-corrugated","1-25-corrugated","7-8-corrugated","3-4-corrugated","titan-loc-100","titan-loc-150","endura-seam","snap-seam","image-ii","snap-loc-150","vertical-seam","bbm-board-batten","flush-loc","steel-soffit","craftsman-board-batten","craftsman-lap","edco-board-batten","hat-channel","steel-tubing","american-pole-barn","steel-truss","stile-spanish-tile","apex-panel","steel-trusses","craftsman-steel-board-and-batten"],
      "asheville": ["tuff-rib","r-panel","5v-crimp","2-5-corrugated","1-25-corrugated","7-8-corrugated","3-4-corrugated","titan-loc-100","titan-loc-150","endura-seam","snap-seam","image-ii","snap-loc-150","vertical-seam","central-loc","bbm-board-batten","flush-loc","steel-soffit","craftsman-board-batten","craftsman-lap","edco-board-batten","edco-traditional-lap","edco-dutchlap","hat-channel","steel-tubing","cee-purlin","zee-purlin","eave-strut","channel","angle","american-pole-barn","steel-truss","stile-spanish-tile","decra-villa","cleo-tile","barrel-vault","pacific-tile","decra-tile","victorian-shingle","sentry-shingle","decra-shingle-xd","cottage-shingle","granite-ridge","piano-shingle","sentry-shake","kasselwood-shake","arrowline-shake","arrowline-enhanced-shake","decra-shake-xd","stonewood-shake","pine-crest-shake","decra-shake","sentry-slate","kasselwood-slate","arrowline-slate","arrowline-enhanced-slate","apex-panel","steel-trusses","craftsman-steel-board-and-batten"],
      "greenville": ["tuff-rib","r-panel","5v-crimp","2-5-corrugated","1-25-corrugated","7-8-corrugated","3-4-corrugated","titan-loc-100","titan-loc-150","endura-seam","snap-seam","image-ii","snap-loc-150","vertical-seam","bbm-board-batten","flush-loc","steel-soffit","craftsman-board-batten","craftsman-lap","edco-board-batten","hat-channel","steel-tubing","american-pole-barn","steel-truss","stile-spanish-tile","apex-panel","steel-trusses","craftsman-steel-board-and-batten"],
      "charlotte": ["tuff-rib","r-panel","5v-crimp","2-5-corrugated","1-25-corrugated","7-8-corrugated","3-4-corrugated","titan-loc-100","titan-loc-150","endura-seam","snap-seam","image-ii","snap-loc-150","vertical-seam","bbm-board-batten","flush-loc","steel-soffit","craftsman-board-batten","craftsman-lap","edco-board-batten","hat-channel","steel-tubing","american-pole-barn","steel-truss","stile-spanish-tile","apex-panel","steel-trusses","craftsman-steel-board-and-batten"],
      "knoxville": ["tuff-rib","r-panel","5v-crimp","2-5-corrugated","1-25-corrugated","7-8-corrugated","3-4-corrugated","titan-loc-100","titan-loc-150","endura-seam","snap-seam","image-ii","snap-loc-150","vertical-seam","bbm-board-batten","flush-loc","steel-soffit","craftsman-board-batten","craftsman-lap","edco-board-batten","hat-channel","steel-tubing","american-pole-barn","steel-truss","stile-spanish-tile","decra-villa","barrel-vault","pacific-tile","decra-shingle-xd","cottage-shingle","granite-ridge","arrowline-shake","arrowline-enhanced-shake","decra-shake-xd","pine-crest-shake","arrowline-slate","arrowline-enhanced-slate","apex-panel","steel-trusses","craftsman-steel-board-and-batten"],
      "national": ["tuff-rib","r-panel","5v-crimp","2-5-corrugated","1-25-corrugated","7-8-corrugated","3-4-corrugated","titan-loc-100","titan-loc-150","endura-seam","snap-seam","image-ii","snap-loc-150","vertical-seam","central-loc","bbm-board-batten","flush-loc","steel-soffit","craftsman-board-batten","craftsman-lap","edco-board-batten","edco-traditional-lap","edco-dutchlap","hat-channel","steel-tubing","cee-purlin","zee-purlin","eave-strut","channel","angle","american-pole-barn","steel-truss","stile-spanish-tile","decra-villa","cleo-tile","barrel-vault","pacific-tile","decra-tile","victorian-shingle","sentry-shingle","decra-shingle-xd","cottage-shingle","granite-ridge","piano-shingle","sentry-shake","kasselwood-shake","arrowline-shake","arrowline-enhanced-shake","decra-shake-xd","stonewood-shake","pine-crest-shake","decra-shake","sentry-slate","kasselwood-slate","arrowline-slate","arrowline-enhanced-slate","apex-panel","steel-trusses","craftsman-steel-board-and-batten"]
    };

    let isAvailable = "False";
    if (foundProduct && storeData[locationInput]) {
      if (storeData[locationInput].includes(foundProduct)) {
        isAvailable = "True";
      }
    }

    // Determine the "Product Location" for the email based on availability
    let productLocationRaw = (isAvailable === "True") ? locationInput : "national";
    let formattedProductLocation = productLocationRaw.charAt(0).toUpperCase() + productLocationRaw.slice(1);

    logBody += `--- MATCHED DATA ---\nProduct Slug: ${foundProduct}\nIs Available: ${isAvailable}\nRouted Location: ${formattedProductLocation}\n\n`;

    const baseOptions = {
      contentType: 'application/json',
      headers: { 'Authorization': 'Bearer ' + HUBSPOT_ACCESS_TOKEN },
      muteHttpExceptions: true
    };

    logBody += `--- API RESPONSES ---\n`;

    // --- STEP 3: UPDATE HUBSPOT CONTACT ---
    const updateContactUrl = `https://api.hubapi.com/crm/v3/objects/contacts/${recordId}`;
    const contactProps = {
      "product_slug": foundProduct,
      "current_bbm_location": locationInput
    };
    
    // Push the calculated distance/time properties to HubSpot if we gathered them
    if (driveData) {
      Object.keys(driveData).forEach(key => {
        // Exclude the helper variables we appended manually
        if (key !== 'bbm_location' && key !== 'bbm_location_minutes') {
          contactProps[key] = driveData[key].toString();
        }
      });
    }

    const contactPayload = { properties: contactProps };
    
    const contactRes = UrlFetchApp.fetch(updateContactUrl, { 
      ...baseOptions, 
      method: 'patch', 
      payload: JSON.stringify(contactPayload) 
    });
    logBody += `Contact Update [HTTP ${contactRes.getResponseCode()}]:\n${contactRes.getContentText()}\n\n`;

    // --- STEP 3.5: CHECK FOR RECENT DEALS (24H THROTTLE) ---
    const now = new Date().getTime();
    const twentyFourHoursAgo = now - (24 * 60 * 60 * 1000);
    let shouldCreateDeal = true;
    let dealId = null;

    try {
      const assocUrl = `https://api.hubapi.com/crm/v3/objects/contacts/${recordId}/associations/deals`;
      const assocRes = UrlFetchApp.fetch(assocUrl, baseOptions);
      const assocData = JSON.parse(assocRes.getContentText());
      const associatedDealIds = (assocData.results || []).map(r => r.id);

      if (associatedDealIds.length > 0) {
        const batchReadUrl = `https://api.hubapi.com/crm/v3/objects/deals/batch/read`;
        const batchPayload = {
          inputs: associatedDealIds.map(id => ({ id })),
          properties: ["createdate"]
        };
        const batchRes = UrlFetchApp.fetch(batchReadUrl, {
          ...baseOptions,
          method: 'post',
          payload: JSON.stringify(batchPayload)
        });
        const batchData = JSON.parse(batchRes.getContentText());

        for (const deal of (batchData.results || [])) {
          const createTime = new Date(deal.properties.createdate).getTime();
          if (createTime > twentyFourHoursAgo) {
            shouldCreateDeal = false;
            dealId = deal.id; 
            logBody += `Recent Deal Found: Deal ID ${deal.id} created at ${deal.properties.createdate}. Associating new Inquiry with THIS existing deal.\n\n`;
            break;
          }
        }
      }
    } catch (e) {
      logBody += `Warning: Error checking for recent deals: ${e.toString()}\n\n`;
    }

    // --- STEP 4: CREATE A DEAL ---
    if (shouldCreateDeal) {
      // Route the pipeline based on the fulfilling store (productLocationRaw handles availability overrides)
      const routingData = PIPELINE_MAP[productLocationRaw] || PIPELINE_MAP["national"];
      
      const dealPayload = {
        properties: {
          "dealname": `New Inquiry - ${foundProduct || 'Unknown Product'}`,
          "pipeline": routingData.pipeline,
          "dealstage": routingData.dealstage 
        }
      };

      const dealResponse = UrlFetchApp.fetch('https://api.hubapi.com/crm/v3/objects/deals', {
        ...baseOptions,
        method: 'post',
        payload: JSON.stringify(dealPayload)
      });
      logBody += `Deal Creation [HTTP ${dealResponse.getResponseCode()}] (Pipeline: ${routingData.pipeline}):\n${dealResponse.getContentText()}\n\n`;
      const dealData = JSON.parse(dealResponse.getContentText());
      dealId = dealData.id;
    }

    // --- STEP 5: CREATE AN INQUIRY (Custom Object) ---
    const inquiryPayload = {
      properties: {
        "inquiry_name": `New Inquiry - ${foundProduct || 'Unknown Product'}`,
        "bbm_location": locationInput,
        "product_slug": foundProduct
      }
    };

    const inquiryResponse = UrlFetchApp.fetch('https://api.hubapi.com/crm/v3/objects/2-59384707', {
      ...baseOptions,
      method: 'post',
      payload: JSON.stringify(inquiryPayload)
    });
    logBody += `Inquiry Creation [HTTP ${inquiryResponse.getResponseCode()}]:\n${inquiryResponse.getContentText()}\n\n`;
    const inquiryData = JSON.parse(inquiryResponse.getContentText());
    const inquiryId = inquiryData.id;

    // --- STEP 6: ASSOCIATE RECORDS ---
    if (dealId && recordId) {
      const a1 = UrlFetchApp.fetch(`https://api.hubapi.com/crm/v4/associations/deals/contacts/batch/create`, {
        ...baseOptions, 
        method: 'post',
        payload: JSON.stringify({
          inputs: [{
            from: { id: dealId },
            to: { id: recordId },
            types: [{ associationCategory: "HUBSPOT_DEFINED", associationTypeId: 3 }]
          }]
        })
      });
      logBody += `Assoc Deal->Contact [HTTP ${a1.getResponseCode()}]\n`;
    }

    if (inquiryId && recordId) {
      const a2 = UrlFetchApp.fetch(`https://api.hubapi.com/crm/v4/associations/2-59384707/contacts/batch/create`, {
        ...baseOptions, 
        method: 'post',
        payload: JSON.stringify({
          inputs: [{
            from: { id: inquiryId },
            to: { id: recordId },
            types: [{ associationCategory: "USER_DEFINED", associationTypeId: 39 }]
          }]
        })
      });
      logBody += `Assoc Inquiry->Contact [HTTP ${a2.getResponseCode()}]\n`;
    }

    if (inquiryId && dealId) {
      const a3 = UrlFetchApp.fetch(`https://api.hubapi.com/crm/v4/associations/2-59384707/deals/batch/create`, {
        ...baseOptions, 
        method: 'post',
        payload: JSON.stringify({
          inputs: [{
            from: { id: inquiryId },
            to: { id: dealId },
            types: [{ associationCategory: "USER_DEFINED", associationTypeId: 37 }]
          }]
        })
      });
      logBody += `Assoc Inquiry->Deal [HTTP ${a3.getResponseCode()}]\n`;
    }

    // --- STEP 7: EXTRACT ATTACHMENTS AND CREATE NOTE ---
    if (attachmentLinks.length > 0) {
      try {
        let fileIds = [];
        let noteBodyLinks = [];

        attachmentLinks.forEach((link, index) => {
          if (link.includes('signed-url-redirect/')) {
            let fileId = link.split('signed-url-redirect/')[1].split('?')[0];
            fileIds.push(fileId);
            noteBodyLinks.push(`Attachment ${index + 1}: <a href="${link}" target="_blank">View File</a>`);
            logBody += `Extracted File ID: ${fileId}\n`;
          } else {
            noteBodyLinks.push(`Attachment ${index + 1}: <a href="${link}" target="_blank">${link}</a>`);
            logBody += `Could not extract File ID for attachment ${index + 1}, defaulting to URL.\n`;
          }
        });

        const noteProperties = {
          "hs_note_body": `Customer provided ${attachmentLinks.length} attachment(s) from form submission:<br><br>${noteBodyLinks.join('<br>')}`,
          "hs_timestamp": new Date().toISOString()
        };

        if (fileIds.length > 0) {
          noteProperties["hs_attachment_ids"] = fileIds.join(';');
        }

        const notePayload = { properties: noteProperties };

        const noteResponse = UrlFetchApp.fetch('https://api.hubapi.com/crm/v3/objects/notes', {
          ...baseOptions, method: 'post', payload: JSON.stringify(notePayload)
        });
        
        if (noteResponse.getResponseCode() === 201) {
          const noteId = JSON.parse(noteResponse.getContentText()).id;
          logBody += `Attachment Note Created [ID: ${noteId}]\n`;

          if (noteId && recordId) {
            UrlFetchApp.fetch(`https://api.hubapi.com/crm/v4/associations/notes/contacts/batch/create`, {
              ...baseOptions, method: 'post',
              payload: JSON.stringify({ inputs: [{ from: { id: noteId }, to: { id: recordId }, types: [{ associationCategory: "HUBSPOT_DEFINED", associationTypeId: 202 }] }] })
            });
            logBody += `Assoc Note->Contact\n`;
          }

          if (noteId && dealId) {
            UrlFetchApp.fetch(`https://api.hubapi.com/crm/v4/associations/notes/deals/batch/create`, {
              ...baseOptions, method: 'post',
              payload: JSON.stringify({ inputs: [{ from: { id: noteId }, to: { id: dealId }, types: [{ associationCategory: "HUBSPOT_DEFINED", associationTypeId: 214 }] }] })
            });
            logBody += `Assoc Note->Deal\n`;
          }

          if (noteId && inquiryId && NOTE_TO_INQUIRY_ASSOC_ID) {
            UrlFetchApp.fetch(`https://api.hubapi.com/crm/v4/associations/notes/2-59384707/batch/create`, {
              ...baseOptions, method: 'post',
              payload: JSON.stringify({ inputs: [{ from: { id: noteId }, to: { id: inquiryId }, types: [{ associationCategory: "USER_DEFINED", associationTypeId: NOTE_TO_INQUIRY_ASSOC_ID }] }] })
            });
            logBody += `Assoc Note->Inquiry\n`;
          } else if (noteId && inquiryId) {
            logBody += `Skipped Note->Inquiry Assoc (Missing NOTE_TO_INQUIRY_ASSOC_ID in script config)\n`;
          }
        } else {
           logBody += `Failed to create Note. HTTP ${noteResponse.getResponseCode()}: ${noteResponse.getContentText()}\n`;
        }
      } catch (e) {
        logBody += `Warning: Error creating/associating attachment note: ${e.toString()}\n`;
      }
    }

    // --- STEP 7.5: CLEAR SITE ADDRESS & ATTACHMENT FIELDS ON CONTACT ---
    // Moved outside the attachment condition so fields are ALWAYS cleared
    try {
      Utilities.sleep(3000); // Prevent Race Condition

      const clearPayload = {
        properties: {
          "request_pricing_attachment": "",
          "measurement_method": "",
          "site_address_line_1": "",
          "site_address_line_2": "",
          "site_address_city": "",
          "site_address_state": "",
          "site_address_zip_code": ""
        }
      };
      
      const clearResponse = UrlFetchApp.fetch(`https://api.hubapi.com/crm/v3/objects/contacts/${recordId}`, {
        ...baseOptions,
        method: 'patch',
        payload: JSON.stringify(clearPayload)
      });
      logBody += `Cleared properties 'request_pricing_attachment', 'measurement_method', and site address fields on Contact [HTTP ${clearResponse.getResponseCode()}]\n`;
    } catch (e) {
      logBody += `Warning: Could not clear properties on Contact: ${e.toString()}\n`;
    }


    // --- STEP 8: SEND FORMATTED HTML EMAIL ---
    if (NOTIFICATION_EMAIL) {
      const notificationSubject = `${formattedProductLocation} - ${foundProduct || 'General Lead'} - ${firstName} ${lastName} - ${postalCode} - Bluemail`;
      
      const tableStyle = "border-collapse: collapse; width: 100%; max-width: 600px; font-family: Arial, sans-serif; font-size: 14px;";
      const thStyle = "border: 1px solid #dddddd; text-align: left; padding: 10px; background-color: #666666; color: #ffffff; font-weight: bold;";
      const tdLabelStyle = "border: 1px solid #dddddd; text-align: left; padding: 8px; font-weight: bold; width: 35%; background-color: #f9f9f9;";
      const tdValueStyle = "border: 1px solid #dddddd; text-align: left; padding: 8px;";

      // Helper function to check if a value is worth displaying
      const hasValue = (val) => val && val !== "Not Provided" && val.toString().trim() !== "";

      // Build Customer Details rows dynamically
      let customerDetailsHtml = "";
      if (hasValue(firstName)) customerDetailsHtml += `<tr><td style="${tdLabelStyle}">First Name</td><td style="${tdValueStyle}">${firstName}</td></tr>`;
      if (hasValue(lastName)) customerDetailsHtml += `<tr><td style="${tdLabelStyle}">Last Name</td><td style="${tdValueStyle}">${lastName}</td></tr>`;
      if (hasValue(email)) customerDetailsHtml += `<tr><td style="${tdLabelStyle}">Email</td><td style="${tdValueStyle}"><a href="mailto:${email}">${email}</a></td></tr>`;
      if (hasValue(phone)) customerDetailsHtml += `<tr><td style="${tdLabelStyle}">Phone Number</td><td style="${tdValueStyle}">${phone}</td></tr>`;
      if (hasValue(postalCode)) customerDetailsHtml += `<tr><td style="${tdLabelStyle}">Postal Code</td><td style="${tdValueStyle}">${postalCode}</td></tr>`;

      // Build Inquiry & Project Details rows dynamically
      let projectDetailsHtml = "";
      if (hasValue(locationInput)) projectDetailsHtml += `<tr><td style="${tdLabelStyle}">Nearest BBM Location</td><td style="${tdValueStyle}">${locationInput}</td></tr>`;
      if (hasValue(foundProduct)) projectDetailsHtml += `<tr><td style="${tdLabelStyle}">Initial Product Slug</td><td style="${tdValueStyle}">${foundProduct}</td></tr>`;
      if (hasValue(formattedProductLocation)) projectDetailsHtml += `<tr><td style="${tdLabelStyle}">Product Location</td><td style="${tdValueStyle}">${formattedProductLocation}</td></tr>`;

      const hasSiteAddress = hasValue(siteStreet1) || hasValue(siteCity) || hasValue(siteState) || hasValue(siteZip);
      if (hasSiteAddress) {
        projectDetailsHtml += `
          <tr>
            <td style="${tdLabelStyle}">Site Address</td>
            <td style="${tdValueStyle}">
              ${hasValue(siteStreet1) ? siteStreet1 + '<br>' : ''}
              ${hasValue(siteStreet2) ? siteStreet2 + '<br>' : ''}
              ${hasValue(siteCity) ? siteCity + ', ' : ''}${hasValue(siteState) ? siteState : ''} ${hasValue(siteZip) ? siteZip : ''}
            </td>
          </tr>`;
      }

      if (hasValue(measurementMethod)) projectDetailsHtml += `<tr><td style="${tdLabelStyle}">Measurement Method</td><td style="${tdValueStyle}">${measurementMethod}</td></tr>`;
      if (hasValue(lastPageSeen)) projectDetailsHtml += `<tr><td style="${tdLabelStyle}">Last Page Seen</td><td style="${tdValueStyle}"><a href="${lastPageSeen}">${lastPageSeen}</a></td></tr>`;
      
      if (attachmentLinks.length > 0) {
        projectDetailsHtml += `<tr><td style="${tdLabelStyle}">Attachment(s)</td><td style="${tdValueStyle}">${attachmentLinks.map((link, i) => `<a href="${link}" target="_blank">View Attachment ${i + 1}</a>`).join('<br>')}</td></tr>`;
      }

      if (hasValue(contractor)) projectDetailsHtml += `<tr><td style="${tdLabelStyle}">Is Contractor?</td><td style="${tdValueStyle}">${contractor}</td></tr>`;

      // Build Customer Message section dynamically
      let messageHtml = "";
      if (hasValue(floatingMessage)) {
        messageHtml = `
          <tr><th colspan="2" style="${thStyle}">Customer Message</th></tr>
          <tr><td colspan="2" style="${tdValueStyle}"><em>"${floatingMessage}"</em></td></tr>
        `;
      }

      const notificationHtml = `
        <table style="${tableStyle}">
          <tr><th colspan="2" style="${thStyle}">Customer Details</th></tr>
          ${customerDetailsHtml}
          <tr><th colspan="2" style="${thStyle}">Inquiry & Project Details</th></tr>
          ${projectDetailsHtml}
          ${messageHtml}
        </table>
      `;

      // Build Plain Text fallback dynamically
      const nameStr = [firstName, lastName].filter(n => hasValue(n)).join(' ');
      let plainTextLines = [`New Inquiry${nameStr ? ' from ' + nameStr : ''}.`];
      
      if (hasValue(email)) plainTextLines.push(`Email: ${email}`);
      if (hasValue(phone)) plainTextLines.push(`Phone: ${phone}`);
      if (hasValue(postalCode)) plainTextLines.push(`Zip: ${postalCode}`);
      if (hasSiteAddress) plainTextLines.push(`Site Address: ${[siteStreet1, siteStreet2, `${hasValue(siteCity) ? siteCity : ''}${hasValue(siteState) || hasValue(siteZip) ? ',' : ''} ${hasValue(siteState) ? siteState : ''} ${hasValue(siteZip) ? siteZip : ''}`.trim()].filter(Boolean).join(', ')}`);
      if (hasValue(measurementMethod)) plainTextLines.push(`Measurement Method: ${measurementMethod}`);
      if (attachmentLinks.length > 0) plainTextLines.push(`Attachment(s): ${attachmentLinks.join(', ')}`);
      if (hasValue(contractor)) plainTextLines.push(`Contractor: ${contractor}`);
      if (hasValue(floatingMessage)) plainTextLines.push(`Message: ${floatingMessage}`);
      
      const notificationPlainText = plainTextLines.join('\n');

      const emailOptions = { htmlBody: notificationHtml };

      if (SENDER_ALIAS) {
        const allowedAliases = GmailApp.getAliases();
        if (allowedAliases.includes(SENDER_ALIAS)) {
          emailOptions.from = SENDER_ALIAS;
        } else {
          logBody += `\n[WARNING] The alias '${SENDER_ALIAS}' is not verified in this Google Account's Gmail settings. Falling back to default email address.\n`;
        }
      }

      GmailApp.sendEmail(
        NOTIFICATION_EMAIL,
        notificationSubject,
        notificationPlainText,
        emailOptions
      );
    }

    if (LOG_EMAIL) {
      GmailApp.sendEmail(
        LOG_EMAIL,
        `HubSpot Webhook Log - Success - ${foundProduct || 'No Product'}`,
        logBody
      );
    }

    PropertiesService.getScriptProperties().setProperty('LAST_SUCCESSFUL_WEBHOOK', new Date().getTime().toString());

    return ContentService.createTextOutput("Processed Successfully: Updated Contact, Created Deal & Inquiry, Associated All, and Sent Notifications.").setMimeType(ContentService.MimeType.TEXT);

  } catch (error) {
    logBody += `\n\n--- CRITICAL ERROR ---\n${error.toString()}\n${error.stack || ''}`;
    
    if (LOG_EMAIL) {
      GmailApp.sendEmail(
        LOG_EMAIL,
        "HubSpot Webhook Log - ERROR",
        logBody
      );
    }

    return ContentService.createTextOutput("Error: " + error.toString()).setMimeType(ContentService.MimeType.TEXT);
  }
}

// ==========================================
// GOOGLE MAPS API HELPER FUNCTION
// ==========================================

/**
 * Fetches drive time and distance data from the Google Maps Distance Matrix API
 * and returns it as a single object with specific, location-based keys.
 * It also determines the location with the shortest drive time and assigns it to the
 * 'bbm_location' key.
 * @param {string} origin The starting address.
 * @param {object} locations An object mapping location names to addresses.
 * @return {object|null} An object with specific keys or null on failure.
 */
function getAttributedDriveTimeData(origin, locations) {
  if (!origin || !locations || Object.keys(locations).length === 0) {
    return null;
  }

  const destinationAddresses = Object.values(locations);
  const destinationString = destinationAddresses.join('|');
  const url = `https://maps.googleapis.com/maps/api/distancematrix/json?origins=${encodeURIComponent(origin)}&destinations=${encodeURIComponent(destinationString)}&key=${GOOGLE_MAPS_API_KEY}`;

  try {
    const response = UrlFetchApp.fetch(url);
    const data = JSON.parse(response.getContentText());

    if (data.status !== 'OK') {
      console.error(`API Error: ${data.status}. Reason: ${data.error_message || 'No details.'}`);
      return null;
    }

    const resultsObject = {};
    const elements = data.rows[0].elements;
    const locationNames = Object.keys(locations);

    let shortestDriveTime = Infinity;
    let shortestTimeLocation = null;

    for (let i = 0; i < locationNames.length; i++) {
      const element = elements[i];
      const locationName = locationNames[i];
      
      if (element.status === 'OK') {
        // Convert drive time from seconds to minutes and round to the nearest whole number
        const driveTimeMinutes = Math.round(element.duration.value / 60);

        // Convert distance from meters to miles and round to two decimal places
        const driveDistanceMiles = parseFloat((element.distance.value / 1609.34).toFixed(2));

        // Construct the keys based on the requested format
        const driveTimeKey = `${locationName.toLowerCase()}_drive_time__minutes_`;
        // const driveDistanceTextKey = `${locationName.toLowerCase()}_drive_distance__text_`; // Commented out in original
        const driveDistanceValueKey = `${locationName.toLowerCase()}_drive_distance__miles_`;
        
        resultsObject[driveTimeKey] = driveTimeMinutes;
        resultsObject[driveDistanceValueKey] = driveDistanceMiles;

        // Check if this is the shortest drive time found so far
        if (driveTimeMinutes < shortestDriveTime) {
          shortestDriveTime = driveTimeMinutes;
          shortestTimeLocation = locationName;
        }
      }
    }

    // Set the 'bbm_location' to the name of the location with the shortest drive time
    resultsObject.bbm_location = shortestTimeLocation;
    resultsObject.bbm_location_minutes = shortestDriveTime;
    
    // Check and set BBM location to "National" based on conditions
    if (resultsObject.bbm_location === "Knoxville" && resultsObject.bbm_location_minutes > 180) {
      resultsObject.bbm_location = "National";
    }
    if (resultsObject.bbm_location !== "Knoxville" && resultsObject.bbm_location_minutes > 150) {
      resultsObject.bbm_location = "National";
    }
    
    return resultsObject;
  } catch (e) {
    console.error(`Failed to fetch or parse Google Maps data: ${e.toString()}`);
    return null;
  }
}