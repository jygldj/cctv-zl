package com.daoxuan.cctv;

import android.app.Activity;
import android.content.Intent;
import android.content.pm.ActivityInfo;
import android.os.Bundle;
import android.view.KeyEvent;
import android.view.Window;
import android.view.WindowManager;
import android.widget.Toast;

import androidx.databinding.DataBindingUtil;

import com.daoxuan.cctv.databinding.ActivityStartBinding;
import com.daoxuan.cctv.util.ValueUtil;
import com.daoxuan.cctv.utils.ToastUtils;

/**
 * 启动页：直接进入主界面，不依赖网络。
 */
public class StartActivity extends Activity {
    private long mClickBackTime = 0;
    protected ActivityStartBinding binding;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        requestWindowFeature(Window.FEATURE_NO_TITLE);
        getWindow().setFlags(WindowManager.LayoutParams.FLAG_FULLSCREEN, WindowManager.LayoutParams.FLAG_FULLSCREEN);
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_ALT_FOCUSABLE_IM);
        setRequestedOrientation(ActivityInfo.SCREEN_ORIENTATION_LANDSCAPE);
        binding = DataBindingUtil.setContentView(this, R.layout.activity_start);
        binding.progressLoad.postDelayed(new Runnable() {
            @Override
            public void run() {
                to();
            }
        }, 200);
    }

    private void to() {
        // 根据设置跳转到不同页面（默认开屏进视频点播主页 index，与原作者3.0一致）
        String startPage = ValueUtil.getString(this, "startPage", "main");
        Intent intent;
        if ("live".equals(startPage)) {
            intent = new Intent(StartActivity.this, LiveActivity.class);
        } else {
            intent = new Intent(StartActivity.this, MainActivity.class);
        }
        startActivity(intent);
        finish();
    }

    @Override
    public boolean onKeyDown(int keyCode, KeyEvent event) {
        if (keyCode == KeyEvent.KEYCODE_BACK) {
            keyBack();
            return true;
        }
        return super.onKeyDown(keyCode, event);
    }

    private void keyBack() {
        long currentTime = System.currentTimeMillis();
        if (currentTime - mClickBackTime < 3000) {
            finishAffinity();
        } else {
            ToastUtils.show(this, "再按一次返回键退出", Toast.LENGTH_SHORT);
            mClickBackTime = currentTime;
        }
    }
}
