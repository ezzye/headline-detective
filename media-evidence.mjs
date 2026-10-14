export function summarizeMedia(records = []) {
  const categories = [
    {id:'video',label:'TV & web video',channels:['tv','online_video']},
    {id:'audio',label:'Radio & podcasts',channels:['radio','podcast']},
    {id:'social',label:'Social uploads',channels:['social']}
  ];
  const unique = [...new Map(records.map(record => [record.id,record])).values()];
  return {recordCount:unique.length, categories:categories.map(category=>({...category,count:unique.filter(record=>category.channels.includes(record.channel)).length})), linkedWrittenFormats:unique.filter(record=>record.linkedWrittenRecordId).length, knownBroadcastSlots:unique.reduce((sum,record)=>sum+new Set((record.distributionEvents||[]).filter(event=>['broadcast','repeat_broadcast'].includes(event.kind)).map(event=>`${event.date}|${event.time}|${event.timezone}`)).size,0)};
}

export function validMediaRecord(record, caseItem) {
  const iso=value=>typeof value==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(value)&&!Number.isNaN(Date.parse(value+'T00:00:00Z'));
  const https=value=>{try{return new URL(value).protocol==='https:';}catch{return false;}};
  if(!record||typeof record.id!=='string'||!record.id.startsWith('media-')||!['tv','online_video','radio','podcast','social'].includes(record.channel)||!['audio','video','social_post'].includes(record.format)||!iso(record.date)||record.date<caseItem.start||record.date>caseItem.end||!https(record.url))return false;
  if(!['hosting_page_publication','platform_upload_date','episode_release','broadcast_schedule','platform_post_date','attributed_post_date','contemporaneous_report_date','archive_post_date'].includes(record.dateBasis)||!['outlet','title','sourceBasis','summary','limit','contentBasis','verifiedAt'].every(key=>typeof record[key]==='string'&&record[key].trim()))return false;
  if(record.format==='social_post'&&(record.channel!=='social'||!['original_post','contemporaneous_report','archived_post'].includes(record.contentBasis)||!['platform_post_date','attributed_post_date','contemporaneous_report_date','archive_post_date'].includes(record.dateBasis)))return false;
  if(record.contentBasis==='archived_post'&&(!https(record.archiveURL)||record.dateBasis!=='archive_post_date'||Number.isNaN(Date.parse(record.captureTimestamp))))return false;
  if(record.publicationRole!==undefined&&(record.format!=='social_post'||!['outlet_promotion','allegation_amplification','speculation','personal_targeting','counter_speech','context'].includes(record.publicationRole)))return false;
  if(record.format==='social_post'&&record.contentBasis==='contemporaneous_report'&&(!https(record.reportURL)||!iso(record.reportDate)))return false;
  if(record.dateBasis==='contemporaneous_report_date'&&(record.postPublicationDate!==null||record.date!==record.reportDate))return false;
  if(!Array.isArray(record.evidenceIds)||!record.evidenceIds.length||!record.evidenceIds.every(id=>caseItem.evidence.some(e=>e.id===id)))return false;
  if(record.linkedWrittenRecordId&&!caseItem.allHeadlines?.some(row=>row.id===record.linkedWrittenRecordId))return false;
  if(record.promotedWrittenRecordId!==undefined&&(record.format!=='social_post'||record.promotedWrittenRecordId!==null&&!caseItem.allHeadlines?.some(row=>row.id===record.promotedWrittenRecordId)))return false;
  if(!record.duration||record.duration.topicSeconds!==null&&( !Number.isInteger(record.duration.topicSeconds)||record.duration.topicSeconds<0||record.duration.topicSeconds>record.duration.totalSeconds))return false;
  if(record.duration.totalSeconds!==null&&(!Number.isInteger(record.duration.totalSeconds)||record.duration.totalSeconds<0))return false;
  if(!Array.isArray(record.distributionEvents)||record.distributionEvents.some(event=>!['broadcast','repeat_broadcast','outlet_social_upload','repost','linked_post'].includes(event.kind)||!iso(event.date)||!https(event.url)))return false;
  if(!Array.isArray(record.observedMetrics)||record.observedMetrics.some(metric=>!['views','shares','likes'].includes(metric.name)||!Number.isSafeInteger(metric.value)||metric.value<0||Number.isNaN(Date.parse(metric.observedAt))||!https(metric.sourceURL)||typeof metric.scope!=='string'||!metric.scope))return false;
  return true;
}
