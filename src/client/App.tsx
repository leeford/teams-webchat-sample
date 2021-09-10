import React, { useEffect, useMemo, useState } from 'react';
import ReactWebChat, { createDirectLine } from 'botframework-webchat';

const App = (): JSX.Element => {

    const [token, setToken] = useState<string>();
    const [userId, setUserId] = useState<string>();

    const getWebChatToken = async () => {
        const res = await fetch('/api/tokens', { method: 'POST' });
        const { token, userId } = await res.json();
        setToken(token);
        setUserId(userId);
    }

    useEffect(() => {
        getWebChatToken();
    }, []);

    const directLine = useMemo(() => createDirectLine({ token: token }), [token, userId]);

    return (
        <ReactWebChat directLine={directLine} userID={userId} />
    );
};

export default App;