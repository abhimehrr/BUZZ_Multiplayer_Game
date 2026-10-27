import type {GameAction,GameState} from "../types";
/** Pure phase transitions. Timer, transport and scoring live outside this module. */
export function transition(s:GameState,a:GameAction):GameState{switch(a.type){
case"START":return s.phase!=="lobby"?s:s.questionIds.length?{...s,phase:"question",round:1,questionIndex:0,answererId:undefined}:{...s,phase:"gameOver"};
case"QUESTION_SHOWN":return s.phase==="reveal"?{...s,phase:"question",round:s.round+1,questionIndex:s.questionIndex+1,answererId:undefined}:s;
case"BUZZ":return s.phase==="question"?{...s,phase:"answering",answererId:a.playerId}:s;
case"ANSWER_RESOLVED":return s.phase==="answering"||s.phase==="question"?{...s,phase:"reveal"}:s;
case"PAUSE":return s.phase==="question"||s.phase==="answering"?{...s,phase:"paused"}:s;
case"RESUME":return s.phase==="paused"?{...s,phase:"question"}:s;
case"FINISH":return s.phase==="gameOver"?s:{...s,phase:"gameOver",answererId:undefined};
case"PLAY_AGAIN":return{...s,phase:"lobby",round:0,questionIndex:0,answererId:undefined};
}}
export function createGameState(targetScore:number,questionIds:string[],roundCap=30):GameState{return{phase:"lobby",round:0,roundCap,targetScore,questionIds,questionIndex:0}}
