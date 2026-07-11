# WeChat Fixture AI Eval: wechat-wang-yangming-heart-study

- verdict: PASS
- metadata: `article.md` and `post.md` preserve the title, source URL, article id, account name, and publish time.
- media: One local article image is preserved and referenced from both raw and normalized Markdown.
- article: `article.md` preserves the raw captured content as evidence, even though WeChat text extraction collapses section boundaries.
- normalized_post: `post.md` restores readable section structure, paragraph breaks, bullet points, image caption, and the final quote without summarizing away the article.
- mhtml: `article.mhtml` exists and preserves a browser snapshot of the source page.
- noise: No login wall, captcha, deleted-content page, home page, unrelated feed text, or account-error page is present.
- actions: None for this fixture. Future prompt or extraction changes must keep `post.md` structured and pass deterministic eval.
