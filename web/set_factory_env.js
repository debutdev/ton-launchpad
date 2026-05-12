const { spawn } = require('child_process');

function setEnv(name, value) {
  return new Promise((resolve, reject) => {
    console.log(`Setting ${name}...`);
    const child = spawn('npx.cmd', ['vercel', 'env', 'add', name, 'production', value], {
      cwd: 'c:/Users/User/tonlaunchpad/web',
      shell: true
    });

    child.stdout.on('data', (data) => {
      const output = data.toString();
      console.log(output);
      if (output.includes('Mark as sensitive?')) {
        child.stdin.write('N\n');
      }
    });

    child.stderr.on('data', (data) => {
      console.error(data.toString());
    });

    child.on('close', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`Exit code ${code}`));
    });
  });
}

async function main() {
  await setEnv('NEXT_PUBLIC_FACTORY_ADDRESS', 'EQDr2R6iI306z_3LPLV3SsZQTq9EYUFwP_-NknUpnbIOudXo');
  console.log('Done!');
}

main();
