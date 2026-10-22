export default async function handler(req,res){
 if(req.method!=='POST')return res.status(405).json({error:'POST 전용'});
 if(!process.env.OPENAI_API_KEY)return res.status(503).json({error:'AI 분석 미설정: Vercel 환경변수 OPENAI_API_KEY를 등록하세요.'});
 try{
  const {images,token,context={}}=req.body||{};
  if(!token||!Array.isArray(images)||images.length<1||images.length>10)return res.status(400).json({error:'이미지 1~10장과 로그인 정보가 필요합니다.'});
  if(images.some(x=>typeof x!=='string'||x.length>4_500_000||!/^data:image\/(jpeg|png|webp);base64,/.test(x)))return res.status(400).json({error:'지원하지 않는 이미지 또는 이미지 크기 초과'});
  const auth=await fetch('https://tscyyygrcimkympnsazo.supabase.co/auth/v1/user',{headers:{apikey:'sb_publishable_C2MxWmSOF02yBbw8Z17mxw_a4S1Timu',Authorization:`Bearer ${token}`}});
  if(!auth.ok)return res.status(401).json({error:'로그인이 만료됐습니다. 다시 로그인하세요.'});
  const user=await auth.json();
  const clean={kind:String(context.kind||'').slice(0,15),workout_date:String(context.workout_date||'').slice(0,10),rpe:Number(context.rpe)||null,athlete_notes:String(context.athlete_notes||'').slice(0,700),history:Array.isArray(context.history)?context.history.slice(0,12).map(w=>({date:w.date,kind:w.kind,pace_sec:w.pace_sec,avg_hr:w.avg_hr,reps:w.reps,distance_m:w.distance_m,rest_sec:w.rest_sec,rpe:w.rpe,splits:w.splits})):[]};
  const instruction=`당신은 5K/10K 러닝 데이터 분석가이자 신중한 코치다. Garmin Connect 스크린샷을 읽고 한국어로 상세한 분석 보고서를 JSON으로 작성한다.
[필수 규칙]
1. 사진에 명확히 보이는 수치만 추출한다. 읽을 수 없거나 이미지에 없는 수치는 null/[]로 남긴다. 그래프 모양만으로 숫자를 만들어내지 않는다. 여러 이미지에서 동일 수치가 충돌하면 확정 입력하지 않고 notes에 설명한다.
2. pace는 전체 달리기 평균인지 빠른 반복구간 평균인지 구분한다. 워밍업/회복이 섞인 전체 평균을 인터벌 목표 페이스로 입력하지 않는다. 명확하지 않으면 pace=null.
3. splits는 반복 구간의 분:초/km 페이스만, split_hr는 대응 구간 심박만 기입한다. 회복 랩과 워밍업 랩은 제외한다. reps/distance_m/rest_sec도 명확할 때만 입력한다.
4. data_reasoning에는 입력한 필드별로 실제 판독값, 해당 화면에서 읽은 근거, 입력/미입력 이유를 구체적으로 설명한다. 수치가 확인되지 않는 항목도 명시한다.
5. LT1은 첫 번째 젖산/환기역치 부근의 지속 가능한 낮은 강도, LT2는 두 번째 역치 부근의 높은 지속 강도다. 단일 훈련 캡처만으로 실제 LT1·LT2 심박/페이스, 젖산 농도, 몸 상태를 확정할 수 없다. LT1 자극은 이지런/지속적 유산소량을, LT2 자극은 반복구간 강도·지속시간·휴식·RPE 등을 근거로 설명하되 강도 분류는 조건부로 기술한다. VO2max 90%를 HRmax 90%와 동일시하지 않는다.
6. interval_analysis는 반복별 페이스 일관성, 심박 상승/회복, 드리프트, 총 질적 훈련량을 실제 확인된 수치로 계산·비교한다. 부족하면 부족하다고 말한다.
7. history_comparison은 전달된 최근 훈련 기록 중 같은 종류·거리·회복시간이 유사한 경우에만 정량 비교한다. 조건이 다르면 차이를 경고한다. 역사 데이터는 참고이며 이미지의 새 기록에 우선하지 않는다.
8. recommendations에는 다음 훈련을 위한 구체적인 실행 제안, 강도 조절 조건, 회복/관찰 지표를 제시한다. 과도한 확신이나 진단은 피한다.
9. 모든 설명은 단편적 문구가 아니라 각 항목 3~6문장 수준의 실제 데이터 기반 서술을 목표로 한다. 데이터가 부족하면 왜 판단 불가능하고 무엇을 더 측정해야 하는지 명확히 쓴다. 측정 근거 없이 'LT2가 개선됐다', '회복됐다'라고 단정하지 않는다.
10. JSON 키: pace(string|null, mm:ss), avg_hr(number|null), max_hr(number|null), reps(number|null), distance_m(number|null), rest_sec(number|null), splits(array of mm:ss strings), split_hr(array of numbers/null), notes(string), summary(string), data_reasoning(array of strings), lt1_assessment(string), lt2_assessment(string), interval_analysis(string), history_comparison(string), recommendations(array of strings), limitations(array of strings). JSON 객체만 출력.`;
  const content=[{type:'text',text:'분석에 사용할 선수 입력 정보와 최근 기록(사용자 제공, 이미지에서 검증되지 않은 값): '+JSON.stringify(clean)+'\n\n첨부된 Garmin 이미지들을 종합 분석하라.'},...images.map(url=>({type:'image_url',image_url:{url,detail:'high'}}))];
  const ai=await fetch('https://api.openai.com/v1/chat/completions',{method:'POST',headers:{'Content-Type':'application/json',Authorization:`Bearer ${process.env.OPENAI_API_KEY}`},body:JSON.stringify({model:process.env.OPENAI_VISION_MODEL||'gpt-4.1-mini',temperature:0,response_format:{type:'json_object'},messages:[{role:'system',content:instruction},{role:'user',content}],max_tokens:3500})});
  const out=await ai.json();if(!ai.ok)return res.status(502).json({error:'AI 요청 실패: '+(out.error?.message||ai.status)});
  const raw=out.choices?.[0]?.message?.content;if(!raw)throw Error('분석 응답이 비어 있습니다.');
  const parsed=JSON.parse(raw);if(out.choices?.[0]?.finish_reason==='length')return res.status(502).json({error:'분석 결과가 길어 응답이 잘렸습니다. 사진을 나누어 다시 시도해 주세요.'});
  return res.status(200).json({data:parsed});
 }catch(e){return res.status(500).json({error:'이미지 분석 오류: '+e.message})}
}
