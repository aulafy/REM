// Reserva un puerto efímero libre (>=1024) y lo libera para que lo use el test.
import {createServer} from 'node:net';
export function freePort(){return new Promise((ok,bad)=>{const s=createServer();s.once('error',bad);s.listen(0,'127.0.0.1',()=>{const {port}=s.address();s.close(()=>ok(port));});});}
