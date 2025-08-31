import fs from "fs"
import path from "path";

async function retrieveSession(sessionId, savePath) {
    const { createClient } = await import('@supabase/supabase-js');
    const supabase = createClient(
        'https://your-project.supabase.co',
        'your-service-role-key'
    );

    try {
        if (!fs.existsSync(savePath)) {
            fs.mkdirSync(savePath, { recursive: true });
        }

        const { data, error } = await supabase
            .storage
            .from('bot-sessions')
            .list(sessionId);

        if (error) throw error;
        if (!data || data.length === 0) throw new Error('❌ No session files found.');

        const credsFile = data.find(file => file.name === 'creds.json');
        if (!credsFile) throw new Error('creds.json not found.');

        const filePath = `${sessionId}/creds.json`;
        const { data: fileData, error: downloadError } = await supabase
            .storage
            .from('bot-sessions')
            .download(filePath);

        if (downloadError) throw downloadError;

        const localFilePath = path.join(savePath, 'creds.json');
        const buffer = Buffer.from(await fileData.arrayBuffer());
        fs.writeFileSync(localFilePath, buffer);
        console.log(`✅ Saved creds.json to ${localFilePath}`);
    } catch (err) {
        console.error('🔥 Failed to retrieve session:', err.message);
    }
}


