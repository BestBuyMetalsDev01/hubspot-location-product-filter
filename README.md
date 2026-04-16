# 🚀 HubSpot Location & Product Filter

An intelligent Google Apps Script gateway that automates lead routing, product identification, and CRM synchronization for HubSpot form submissions.

---

## ✨ Core Features

- **📍 Smart Store Routing**: Automatically calculates the nearest retail location using the Google Maps Distance Matrix API.
- **🏷 Product Auto-Discovery**: Extracts product slugs from referring URLs to provide context on customer interest.
- **🔄 CRM Automation**:
  - Updates Contact properties in real-time.
  - Creates Deals with built-in **24-hour duplicate prevention**.
  - Manages **Inquiry Custom Objects** for granular tracking.
  - Automatically handles **File Attachments** via HubSpot Notes.
- **📧 Rich Notifications**: Sends professionally formatted HTML lead alerts directly to your sales team.

---

## 🛠 Project Stack

| Layer | Technology | Purpose |
| :--- | :--- | :--- |
| **Runtime** | Google Apps Script | Serverless webhook handler. |
| **Logic** | JavaScript (V8) | Routing and API integration. |
| **API** | HubSpot CRM API (v3/v4) | CRM synchronization. |
| **Maps** | GS Distance Matrix | Proximity calculations. |
| **DevOps** | [clasp](https://github.com/google/clasp) | Local development and version control. |

---

## 🚀 Getting Started

### 1. Local Setup
Ensure you have Node.js and the `clasp` CLI installed, then clone the project:
```powershell
clasp clone "13TXY7olFTZNnyZR3sMUbA2hwfCOxa0-hEuJ_PNxxvD6XlbdQnEckSuyf"
clasp login
```

### 2. Configuration
The script requires specific properties set in **Project Settings > Script Properties**:
- `HUBSPOT_ACCESS_TOKEN`: Your HubSpot Private App token.
- `GOOGLE_MAPS_API_KEY`: Your Google Maps API key with Distance Matrix enabled.

### 3. Deployment
Push your local changes to the Apps Script environment:
```powershell
clasp push
```

---

## 📖 In-Depth Documentation

For detailed logic analysis, Data Flow Diagrams (DFDs), and maintenance guides:
👉 **[Technical Documentation](documentation.md)**

---

## 📂 Repository Structure
- `Code.gs`: Main application logic.
- `documentation.md`: Technical deep dive and data flows.
- `.clasp.json`: Clasp configuration.
- `package.json`: NPM dependencies and metadata.
