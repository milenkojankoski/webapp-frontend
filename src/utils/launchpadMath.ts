export enum BondingCurve {
    FIXED = "fixed",
    SIGMOID = "sigmoid",
    EXPONENTIAL = "exponential"
}

export function multiply(bigIntAmount: bigint | string, multiplier: string | number): bigint {
    const amount = BigInt(bigIntAmount);
    const mStr = typeof multiplier === 'number' ? multiplier.toFixed(18) : multiplier.toString();
    if (mStr.includes('.')) {
        let [whole, frac] = mStr.split('.');
        frac = frac.replace(/0+$/, ''); // Remove trailing zeros
        if (frac.length === 0) {
            return amount * BigInt(whole);
        }
        const decimals = frac.length;
        const factor = 10n ** BigInt(decimals);
        const mInt = BigInt(whole + frac);
        return (amount * mInt) / factor;
    }
    return amount * BigInt(mStr);
}

export function divide(bigIntAmount: bigint | string, divisor: string | number | bigint): bigint {
    const amount = BigInt(bigIntAmount);
    if (typeof divisor === 'bigint') {
        return amount / divisor;
    }
    const dStr = typeof divisor === 'number' ? divisor.toFixed(18).replace(/\.?0+$/, '') : divisor.toString();
    if (dStr.includes('.')) {
        const [whole, frac] = dStr.split('.');
        const decimals = frac.length;
        const factor = 10n ** BigInt(decimals);
        const dInt = BigInt(whole + frac);
        return (amount * factor) / dInt;
    }
    return amount / BigInt(dStr);
}

export function getScale(decimals: number): bigint {
    return 10n ** BigInt(decimals);
}

export function calculateLaunchSplit(launchTokens: bigint | string, teamSplit: number, curveType: BondingCurve | string, premiumPercentage: number = 0) {
    let avgRatio_Num: bigint, avgRatio_Den: bigint;

    if (curveType === BondingCurve.SIGMOID) {
        avgRatio_Num = 7n; avgRatio_Den = 9n;
    } else if (curveType === BondingCurve.EXPONENTIAL) {
        avgRatio_Num = 2n; avgRatio_Den = 5n;
    } else {
        avgRatio_Num = 1n; avgRatio_Den = 1n;
    }

    const premiumBps = BigInt(Math.floor(premiumPercentage * 10000));
    const premiumFactor_Num = 10000n + premiumBps;
    const premiumFactor_Den = 10000n;

    const teamSplitBps = BigInt(Math.floor(teamSplit * 10000));
    const teamFactor_Num = 10000n + teamSplitBps;
    const teamFactor_Den = 10000n;

    const ratio_Num = teamFactor_Num * premiumFactor_Num * avgRatio_Den;
    const ratio_Den = teamFactor_Den * premiumFactor_Den * avgRatio_Num;

    const launch = BigInt(launchTokens);
    const poolTokens = (launch * ratio_Den) / (ratio_Num + ratio_Den);
    const saleTokens = launch - poolTokens;

    return {
        saleTokens,
        poolTokens
    };
}

export function calculateLaunchPrices(liquidityGoalRaw: bigint | string, poolSupply: bigint | string, curveType: BondingCurve | string, premiumPercentage: number = 0, pairedTokenDecimals: number = 18) {
    if (BigInt(poolSupply) === 0n) throw new Error("Math Error: LP Supply is zero");

    const SCALE = getScale(pairedTokenDecimals);
    const liquidityGoal = BigInt(liquidityGoalRaw);
    const supply = BigInt(poolSupply);

    const premiumBps = BigInt(Math.floor((premiumPercentage ?? 0) * 10000));
    const listingPrice = divide(multiply(liquidityGoal, SCALE.toString()), supply.toString());

    const finalSalePrice = divide(listingPrice * 10000n, (10000n + premiumBps).toString());

    let startPrice;
    let avg;

    if (curveType === BondingCurve.SIGMOID) {
        startPrice = (finalSalePrice * 5n) / 9n;
        avg = (startPrice + finalSalePrice) / 2n;
    } else if (curveType === BondingCurve.EXPONENTIAL) {
        startPrice = finalSalePrice / 10n;
        avg = startPrice * 4n;
    } else {
        startPrice = finalSalePrice;
        avg = finalSalePrice;
    }

    return {
        listingPrice,
        finalSalePrice,
        avg,
        startPrice
    };
}

export function calculateSpotPrice(curveType: BondingCurve | string, startPrice: bigint, targetRaise: bigint, totalTokenSupply: bigint, tokensSold: bigint, decimals: number = 18): bigint {
    const SCALE = getScale(decimals);
    if (totalTokenSupply === 0n) return 0n;
    if (tokensSold >= totalTokenSupply) {
        return calculateSpotPrice(curveType, startPrice, targetRaise, totalTokenSupply, totalTokenSupply - 1n, decimals);
    }

    const averagePrice = divide(multiply(targetRaise, SCALE.toString()), totalTokenSupply.toString());
    const t = divide(multiply(tokensSold, SCALE.toString()), totalTokenSupply.toString());

    switch (curveType) {
        case BondingCurve.FIXED:
            return startPrice;

        case BondingCurve.EXPONENTIAL:
            if (startPrice >= averagePrice) return averagePrice;
            const slopeExp = multiply(averagePrice - startPrice, 3);
            const tSquared = divide(multiply(t, t.toString()), SCALE.toString());
            const priceIncreaseExp = divide(multiply(slopeExp, tSquared.toString()), SCALE.toString());
            return startPrice + priceIncreaseExp;

        case BondingCurve.SIGMOID:
            if (startPrice >= averagePrice) return averagePrice;
            const slopeSig = multiply(averagePrice - startPrice, 2);
            const t2 = divide(multiply(t, t.toString()), SCALE.toString());
            const t3 = divide(multiply(t2, t.toString()), SCALE.toString());
            const sigmoidProgress = 3n * t2 - 2n * t3;
            const priceIncreaseSig = divide(multiply(slopeSig, sigmoidProgress.toString()), SCALE.toString());
            return startPrice + priceIncreaseSig;

        default:
            throw new Error(`Unknown bonding curve: ${curveType}`);
    }
}
