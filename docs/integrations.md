# Getting the integration keys

The plugin's **Settings** panel (Plugins → SEO, GEO & AIO → Settings) has optional fields for IndexNow, Google Search Console and Bing Webmaster Tools. None of them are needed for the sitemap, Markdown, `llms.txt`, metadata or redirects. Fill in only the ones you want.

Google and Bing secrets are stored as encrypted settings, read only by the plugin's server code, and never shown in the browser again after you save. The IndexNow key is public on purpose.

| Field                                         | What it is for                                       | Where it comes from                         |
| --------------------------------------------- | ---------------------------------------------------- | ------------------------------------------- |
| Submit changed and removed URLs to IndexNow   | Tells Bing, Yandex and other engines when pages change | A switch                                    |
| IndexNow ownership key                        | Proves you own the site                              | You make it up ([IndexNow](#indexnow))      |
| Search Console property                       | Which Search Console property to report on           | Search Console ([property](#search-console-property)) |
| Google access token                           | Not recommended: it expires after an hour            | Leave empty                                 |
| Google OAuth client ID, client secret, refresh token | Reading Search Console data, renewed automatically | Google Cloud ([OAuth](#google-oauth-client-id-client-secret-refresh-token)) |
| Bing Webmaster API key                        | Reading Bing search data                             | Bing Webmaster Tools ([Bing](#bing-webmaster-api-key)) |

## IndexNow

No account or signup is needed.

1. Make up a key of 8 to 128 characters using letters, digits and hyphens. A random one is easiest. On a Mac, run `uuidgen` in Terminal and use the result.
2. Paste it into **IndexNow ownership key**.
3. Turn on **Submit changed and removed URLs to IndexNow** and click **Save settings**.
4. Check that `https://your-site/<key>.txt` shows the key. The plugin publishes this file so search engines can verify you.

After each finished generation, the plugin queues added, changed and removed URLs. The background job (`publication-sync`) submits them once a minute, and the **Submit queued URLs to IndexNow** button on the plugin page (performance section) sends them straight away. A `200` or `202` answer means IndexNow received the list, not that a page was indexed. Do not change the key once you use it; pick a new one only if it was misused.

## Search Console property

1. Open [Google Search Console](https://search.google.com/search-console) and pick your site from the property list.
2. Copy its name into **Search Console property**:
   - A **Domain** property (it shows just the domain, such as `example.com`): enter `sc-domain:example.com`.
   - A **URL prefix** property (it shows a full address): enter it exactly as shown, including `https://` and the final slash, such as `https://example.com/`.

The Google account you use in the next step must have access to this property.

## Google OAuth (client ID, client secret, refresh token)

These three values let the plugin read Search Console data without you signing in again. Leave **Google access token** empty: an access token on its own stops working after an hour.

### 1. Create the client in Google Cloud

1. Go to [console.cloud.google.com](https://console.cloud.google.com) and create a project, or pick an existing one.
2. Open **APIs & Services → Library**, search for **Google Search Console API** and click **Enable**.
3. Open **APIs & Services → OAuth consent screen** (shown as **Google Auth Platform** in newer consoles):
   - Choose **External** and fill in the app name and your email.
   - Under **Audience** (or **Test users**), add the Google account that owns the Search Console property.
   - Click **Publish app** to move it to production. While it stays in **Testing**, Google expires the refresh token after 7 days and the reports stop working. An unverified app works for your own account; you may see a "Google hasn't verified this app" warning, which you can continue past.
4. Open **APIs & Services → Credentials → Create credentials → OAuth client ID**:
   - Application type: **Web application**.
   - Under **Authorized redirect URIs**, add `https://developers.google.com/oauthplayground`.
   - Click **Create** and copy the **Client ID** and **Client secret**.

### 2. Get the refresh token

1. Open the [OAuth 2.0 Playground](https://developers.google.com/oauthplayground).
2. Click the gear icon (top right), tick **Use your own OAuth credentials**, and paste your client ID and client secret.
3. In **Step 1**, type `https://www.googleapis.com/auth/webmasters.readonly` into the scope box and click **Authorize APIs**.
4. Sign in with the Google account that has access to the property and allow access.
5. In **Step 2**, click **Exchange authorization code for tokens** and copy the **Refresh token**.

### 3. Save it in the plugin

Paste the **client ID**, **client secret** and **refresh token** into the plugin's Settings panel, check that **Search Console property** is filled in, and click **Save settings**. Then open the plugin page and fetch a report to confirm it works.

If a report later fails with an authorization error, the refresh token was revoked or expired. Repeat [step 2](#2-get-the-refresh-token) and paste the new token.

## Bing Webmaster API key

1. Sign in to [Bing Webmaster Tools](https://www.bing.com/webmasters).
2. Add your site if it is not there yet. The quickest way is **Import from Google Search Console**, which also verifies it.
3. Click the gear icon (**Settings**), open **API access**, choose **API key** and click **Generate**.
4. Paste the key into **Bing Webmaster API key** and click **Save settings**.

The key gives access to every site in that Bing account, so keep it private. Generate a new one in the same place if it leaks.

## Checking that it works

- **IndexNow:** open `https://your-site/<key>.txt` to see the key, then click **Submit queued URLs to IndexNow** on the plugin page and read the result it reports.
- **Search Console and Bing:** open the plugin page, choose the provider and a period, and click **Fetch report**. An error message says which field is missing or rejected.

What the reports measure, and their limits, is described in [Configuration → IndexNow and webmaster reports](configuration.md#indexnow-and-webmaster-reports).
