// Keep the shareable offline file complete; online visitors fetch only images
// for the case they actually open. Licence/credit metadata stays in both copies.
export function onlinePage(html, manifest) {
  const pattern=/<script id="campaign-data" type="application\/json">([\s\S]*?)<\/script>/;
  const match=html.match(pattern);if(!match)throw Error('Missing campaign data');
  const records=JSON.parse(match[1]);
  const files=new Map((manifest.images||[]).map(image=>[image.filePage,image.file]));
  for(const campaign of records) {
    // Football source rows are already embedded once in the shared comparison corpus.
    campaign.evidence=(campaign.evidence||[]).filter(e=>!e.id.startsWith('football-'));
    // Search logs remain in public case JSON and the complete offline file.
    for(const field of ['researchLeads','archiveChecks','researchLimits'])delete campaign[field];
    // The detailed recovery/search log remains in the standalone audit. Keep
    // only the fields rendered by the game in the visitor's initial payload.
    if(campaign.recoveryDossier) {
      const rendered=['schemaVersion','id','asOf','reportedSettlementArticles','settlementTitles','settlementSource','settlementNote','previousSelectedArticlePackages','newIndependentlyIdentifiedArticleCount','coverReferences','editionParticipationEvidence','gapNote','followupRoutes','titleParticipation','recoveredWebArticles','newRecoveredWebPageCount','additionalArticlesConfirmedAsMembersOf40'];
      campaign.recoveryDossier=Object.fromEntries(rendered.filter(key=>key in campaign.recoveryDossier).map(key=>[key,campaign.recoveryDossier[key]]));
    }
    // Full repeated desk inventories remain in the offline source and server.
    // The UI renders the canonical allHeadlines and compact examples instead.
    for(const desk of campaign.campaigns||[]) {delete desk.records;delete desk.chronologicalRecords;}
    for(const image of campaign.images||[]) {
    const file=files.get(image.filePage);
    if(!file||!/^assets\/images\/[a-z0-9-]+\.(jpg|jpeg|png|webp)$/.test(file))throw Error('Missing licensed image');
    image.url='/'+file;
    }
  }
  const output=html.replace(pattern,()=>'<script id="campaign-data" type="application/json">'+JSON.stringify(records).replace(/</g,'\\u003c')+'</script>');
  return output.replace(/(<script id="comparison-data" type="application\/json">)([\s\S]*?)(<\/script>)/,(_,open,data,close)=>open+JSON.stringify(JSON.parse(data)).replace(/</g,'\\u003c')+close);
}
